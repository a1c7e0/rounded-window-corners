import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm';
import ts from 'typescript';

class Variant {
    constructor(_type, value) {
        this.value = structuredClone(value);
    }
    recursiveUnpack() {
        return structuredClone(this.value);
    }
}

class Settings {
    values = new Map([
        ['debug-mode', false],
        ['border-width', 1],
        ['global-rounded-corner-settings', {padding: {left: 1}}],
    ]);
    reads = new Map();
    connections = new Map();
    nextId = 1;
    get_user_value() {
        return new Variant('u', 9);
    }
    get_value(key) {
        this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
        return new Variant('', this.values.get(key));
    }
    set_value(key, value) {
        // Deliberately defer notification to exercise immediate write invalidation.
        this.values.set(key, value.recursiveUnpack());
    }
    connect(_signal, callback) {
        const id = this.nextId++;
        this.connections.set(id, callback);
        return id;
    }
    disconnect(id) {
        this.connections.delete(id);
    }
    change(key, value) {
        this.values.set(key, structuredClone(value));
        for (const callback of this.connections.values()) callback(this, key);
    }
}

async function fixture() {
    const context = createContext({});
    const source = await readFile(
        new URL('../src/utils/settings.ts', import.meta.url),
        'utf8',
    );
    const {outputText} = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
        },
    });
    const module = new SourceTextModule(outputText, {context});
    await module.link(specifier => {
        if (specifier !== 'gi://GLib')
            throw new Error(`Unexpected import: ${specifier}`);
        return new SyntheticModule(
            ['default'],
            function () {
                this.setExport('default', {Variant});
            },
            {context},
        );
    });
    await module.evaluate();
    return {api: module.namespace, settings: new Settings()};
}

test('runtime caches repeated reads, including false values, and invalidates only changed keys', async () => {
    const {api, settings} = await fixture();
    api.initPrefs(settings, {cache: true});
    for (let i = 0; i < 1000; i++)
        assert.equal(api.getPref('debug-mode'), false);
    assert.equal(settings.reads.get('debug-mode'), 1);
    settings.change('border-width', 2);
    api.getPref('debug-mode');
    assert.equal(settings.reads.get('debug-mode'), 1);
    // Effect observers registered after initPrefs must see the new value.
    let observed;
    settings.connect('changed', () => {
        observed = api.getPref('debug-mode');
    });
    settings.change('debug-mode', true);
    assert.equal(observed, true);
    assert.equal(settings.reads.get('debug-mode'), 2);
    api.uninitPrefs();
});

test('writes invalidate cached data before a delayed changed notification', async () => {
    const {api, settings} = await fixture();
    api.initPrefs(settings, {cache: true});
    assert.equal(api.getPref('border-width'), 1);
    api.setPref('border-width', 7);
    assert.equal(api.getPref('border-width'), 7);
    assert.equal(settings.reads.get('border-width'), 2);
    api.uninitPrefs();
});

test('preference pages keep independent mutable snapshots without opting into cache', async () => {
    const {api, settings} = await fixture();
    api.initPrefs(settings);
    const editable = api.getPref('global-rounded-corner-settings');
    editable.padding.left = 99;
    assert.equal(api.getPref('global-rounded-corner-settings').padding.left, 1);
    assert.equal(settings.connections.size, 0);
    api.uninitPrefs();
});

test('reinitializing and disabling release the cache and its signal connection', async () => {
    const {api, settings} = await fixture();
    api.initPrefs(settings, {cache: true});
    api.getPref('border-width');
    const replacement = new Settings();
    replacement.values.set('border-width', 8);
    api.initPrefs(replacement, {cache: true});
    assert.equal(settings.connections.size, 0);
    assert.equal(api.getPref('border-width'), 8);
    api.uninitPrefs();
    assert.equal(replacement.connections.size, 0);
    api.initPrefs(replacement, {cache: true});
    api.getPref('border-width');
    assert.equal(replacement.reads.get('border-width'), 2);
    api.uninitPrefs();
});
