import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm';
import ts from 'typescript';

class SignalObject {
    signals = new Map();
    nextId = 1;
    connect(name, callback) {
        const id = this.nextId++;
        this.signals.set(id, {name, callback});
        return id;
    }
    disconnect(id) {
        this.signals.delete(id);
    }
    emit(name) {
        for (const {name: signal, callback} of [...this.signals.values()])
            if (signal === name) callback(this);
    }
}

async function fixture() {
    const sources = new Map();
    let nextSource = 1;
    const win = new SignalObject();
    win.wmClass = 'example';
    const texture = new SignalObject();
    const actor = new SignalObject();
    actor.metaWindow = win;
    actor.firstChild = {};
    actor.get_texture = () => texture;
    const wm = new SignalObject();
    const display = new SignalObject();
    const prefs = new SignalObject();
    let updates = 0;
    let removals = 0;
    let finish;
    let hold = false;
    const context = createContext({
        global: {windowManager: wm, display, get_window_actors: () => [actor]},
        logError: error => {
            throw error;
        },
    });
    const glib = {
        PRIORITY_DEFAULT_IDLE: 200,
        SOURCE_REMOVE: false,
        idle_add(_priority, callback) {
            const id = nextSource++;
            sources.set(id, callback);
            return id;
        },
        source_remove(id) {
            sources.delete(id);
        },
    };
    const handlers = {
        onSizeChanged() {
            updates++;
            if (hold)
                return new Promise(resolve => {
                    finish = resolve;
                });
        },
        onFocusChanged() {
            /* Unused signal handler in this fixture. */
        },
        onSettingsChanged() {
            /* Unused signal handler in this fixture. */
        },
        onRestacked() {
            /* Unused signal handler in this fixture. */
        },
        onMinimize() {
            /* Unused signal handler in this fixture. */
        },
        onUnminimize() {
            /* Unused signal handler in this fixture. */
        },
        onRemoveEffect() {
            removals++;
        },
    };
    const mocks = {
        'gi://GLib': {default: glib},
        '../utils/log.js': {
            logDebug() {
                /* Logging is intentionally suppressed in fixtures. */
            },
        },
        '../utils/settings.js': {prefs},
        '../utils/types.js': {
            hasMetaWindow: object => object.metaWindow !== null,
        },
        './event_handlers.js': handlers,
    };
    const modules = new Map();
    async function load(path) {
        if (modules.has(path)) return modules.get(path);
        let module;
        if (mocks[path]) {
            const values = mocks[path];
            module = new SyntheticModule(
                Object.keys(values),
                function () {
                    for (const [key, value] of Object.entries(values))
                        this.setExport(key, value);
                },
                {context},
            );
        } else {
            const file = path.includes('actor_lifetime')
                ? '../src/utils/actor_lifetime.ts'
                : '../src/manager/event_manager.ts';
            const source = await readFile(
                new URL(file, import.meta.url),
                'utf8',
            );
            const {outputText} = ts.transpileModule(source, {
                compilerOptions: {
                    target: ts.ScriptTarget.ES2022,
                    module: ts.ModuleKind.ESNext,
                },
            });
            module = new SourceTextModule(outputText, {context});
        }
        modules.set(path, module);
        await module.link(load);
        return module;
    }
    const module = await load('manager');
    await module.evaluate();
    const flush = async () => {
        for (const [id, callback] of [...sources]) {
            sources.delete(id);
            callback();
        }
        // Drain the completion/finally microtasks before the next simulated idle.
        await new Promise(resolve => setImmediate(resolve));
    };
    return {
        manager: module.namespace,
        actor,
        win,
        texture,
        sources,
        flush,
        updates: () => updates,
        removals: () => removals,
        hold() {
            hold = true;
        },
        finish() {
            finish();
        },
    };
}

test('coalesces actor and texture resize bursts into one update', async () => {
    const f = await fixture();
    f.manager.enableEffect();
    await f.flush();
    for (let i = 0; i < 100; i++) {
        f.actor.emit('notify::size');
        f.texture.emit('size-changed');
    }
    assert.equal(f.sources.size, 1);
    await f.flush();
    assert.equal(f.updates(), 2);
    f.manager.disableEffect();
});

test('destroy cancels queued work before native actor properties become inaccessible', async () => {
    const f = await fixture();
    f.manager.enableEffect();
    f.actor.emit('destroy');
    Object.defineProperty(f.actor, 'metaWindow', {
        get() {
            throw new Error('disposed');
        },
    });
    await f.flush();
    assert.equal(f.updates(), 0);
    assert.equal(f.sources.size, 0);
    assert.equal(f.actor.signals.size, 0);
    assert.equal(f.win.signals.size, 0);
    f.manager.disableEffect();
});

test('disable cancels windows waiting for their first surface and allows clean re-enable', async () => {
    const f = await fixture();
    f.actor.firstChild = null;
    f.manager.enableEffect();
    await f.flush();
    f.manager.disableEffect();
    f.actor.firstChild = {};
    f.actor.emit('notify::first-child');
    await f.flush();
    assert.equal(f.updates(), 0);
    assert.equal(f.actor.signals.size, 0);
    f.manager.enableEffect();
    await f.flush();
    assert.equal(f.updates(), 1);
    f.manager.disableEffect();
});

test('notifications during an async update produce only one follow-up, cancelled on disable', async () => {
    const f = await fixture();
    f.hold();
    f.manager.enableEffect();
    await f.flush();
    for (let i = 0; i < 100; i++) f.actor.emit('notify::size');
    assert.equal(f.sources.size, 0);
    f.finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.sources.size, 1);
    f.manager.disableEffect();
    await f.flush();
    assert.equal(f.updates(), 1);
    assert.equal(f.removals(), 1);
});
