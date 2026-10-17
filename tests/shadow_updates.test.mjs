import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm';
import ts from 'typescript';

async function loadUtils() {
    const context = createContext({});
    const source = await readFile(
        new URL('../src/manager/utils.ts', import.meta.url),
        'utf8',
    );
    const {outputText} = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
        },
    });
    let cssCalls = 0;
    const prefs = {
        'global-rounded-corner-settings': {smoothing: 0.2},
        'keep-shadow-for-maximized-fullscreen': false,
        'tweak-kitty-terminal': false,
    };
    const module = new SourceTextModule(outputText, {context});
    await module.link(specifier => {
        const mocks = {
            'gi://Gio': {default: {}},
            'gi://Meta': {default: {}},
            '../utils/box_shadow.js': {
                boxShadowCss: shadow => {
                    cssCalls++;
                    return `box-shadow: opacity-${shadow.opacity};`;
                },
            },
            '../utils/constants.js': {
                APP_SHADOWS: {kitty: [0, 0, 0, 0]},
                ROUNDED_CORNERS_EFFECT: 'rwc',
                SHADOW_PADDING: 12,
            },
            '../utils/file.js': {readFile: async () => ''},
            '../utils/log.js': {logDebug: () => undefined},
            '../utils/settings.js': {getPref: key => prefs[key]},
        };
        const values = mocks[specifier];
        if (!values) throw new Error(`Unexpected import: ${specifier}`);
        const exports = Object.keys(values);
        return new SyntheticModule(
            exports,
            function () {
                for (const name of exports) this.setExport(name, values[name]);
            },
            {context},
        );
    });
    await module.evaluate();
    return {api: module.namespace, prefs, cssCalls: () => cssCalls};
}

function shadowFixture() {
    let childStyle = '';
    let actorStyle = '';
    const child = {
        styleWrites: 0,
        get style() {
            return childStyle;
        },
        set style(value) {
            childStyle = value;
            this.styleWrites++;
        },
        redraws: 0,
        queue_redraw() {
            this.redraws++;
        },
    };
    const actor = {
        firstChild: child,
        styleWrites: 0,
        get style() {
            return actorStyle;
        },
        set style(value) {
            actorStyle = value;
            this.styleWrites++;
        },
    };
    const win = {
        maximizedHorizontally: false,
        maximizedVertically: false,
        fullscreen: false,
    };
    const padding = {top: 1, right: 2, bottom: 3, left: 4};
    const shadow = {
        opacity: 40,
        spreadRadius: 1,
        blurOffset: 8,
        verticalOffset: 2,
        horizontalOffset: 3,
    };
    return {actor, child, win, padding, shadow};
}

test('identical shadow refreshes skip CSS generation, style writes, and redraws', async () => {
    const {api, cssCalls} = await loadUtils();
    const fixture = shadowFixture();
    api.updateShadowActorStyle(
        fixture.win,
        fixture.actor,
        10,
        fixture.shadow,
        fixture.padding,
    );
    const style = fixture.child.style;
    api.updateShadowActorStyle(
        fixture.win,
        fixture.actor,
        10,
        fixture.shadow,
        fixture.padding,
    );
    assert.equal(cssCalls(), 1);
    assert.equal(fixture.child.redraws, 1);
    assert.equal(fixture.child.style, style);
    assert.equal(fixture.child.styleWrites, 1);
    assert.equal(fixture.actor.styleWrites, 1);
});

test('shadow cache observes in-place preference mutations and window state changes', async () => {
    const {api, prefs, cssCalls} = await loadUtils();
    const fixture = shadowFixture();
    api.updateShadowActorStyle(
        fixture.win,
        fixture.actor,
        10,
        fixture.shadow,
        fixture.padding,
    );
    fixture.padding.left = 9;
    api.updateShadowActorStyle(
        fixture.win,
        fixture.actor,
        10,
        fixture.shadow,
        fixture.padding,
    );
    assert.equal(cssCalls(), 2);
    assert.ok(fixture.child.style.includes('9px'));

    prefs['global-rounded-corner-settings'].smoothing = 0.5;
    api.updateShadowActorStyle(
        fixture.win,
        fixture.actor,
        10,
        fixture.shadow,
        fixture.padding,
    );
    assert.equal(cssCalls(), 3);

    fixture.win.fullscreen = true;
    api.updateShadowActorStyle(
        fixture.win,
        fixture.actor,
        10,
        fixture.shadow,
        fixture.padding,
    );
    assert.equal(fixture.child.style, 'opacity: 0;');
    assert.equal(cssCalls(), 3);
});

test('shadow cache repairs styles changed by another actor', async () => {
    const {api, cssCalls} = await loadUtils();
    const fixture = shadowFixture();
    api.updateShadowActorStyle(
        fixture.win,
        fixture.actor,
        10,
        fixture.shadow,
        fixture.padding,
    );
    fixture.child.style = 'externally modified';
    api.updateShadowActorStyle(
        fixture.win,
        fixture.actor,
        10,
        fixture.shadow,
        fixture.padding,
    );
    assert.equal(cssCalls(), 2);
    assert.notEqual(fixture.child.style, 'externally modified');
});

test('constraint offsets skip equal values and apply changed values', async () => {
    const {api} = await loadUtils();
    const writes = [0, 0];
    const constraints = [0, 4].map((initial, i) => {
        let value = initial;
        return {
            get offset() {
                return value;
            },
            set offset(next) {
                writes[i]++;
                value = next;
            },
        };
    });
    api.updateConstraintOffsets(constraints, [0, 4]);
    assert.deepEqual(writes, [0, 0]);
    api.updateConstraintOffsets(constraints, [2, 4]);
    assert.deepEqual(writes, [1, 0]);
    assert.deepEqual(
        constraints.map(item => item.offset),
        [2, 4],
    );
});

test('changing focused-shadow values in place and keeping fullscreen shadows refreshes CSS', async () => {
    const {api, prefs, cssCalls} = await loadUtils();
    const f = shadowFixture();
    api.updateShadowActorStyle(f.win, f.actor, 10, f.shadow, f.padding);
    f.shadow.opacity = 90;
    api.updateShadowActorStyle(f.win, f.actor, 10, f.shadow, f.padding);
    assert.equal(cssCalls(), 2);
    assert.ok(f.child.style.includes('opacity-90'));
    f.win.fullscreen = true;
    api.updateShadowActorStyle(f.win, f.actor, 10, f.shadow, f.padding);
    assert.equal(f.child.style, 'opacity: 0;');
    prefs['keep-shadow-for-maximized-fullscreen'] = true;
    api.updateShadowActorStyle(f.win, f.actor, 10, f.shadow, f.padding);
    assert.ok(f.child.style.includes('opacity-90'));
});

test('a replacement shadow child receives its initial style even when inputs match', async () => {
    const {api, cssCalls} = await loadUtils();
    const f = shadowFixture();
    api.updateShadowActorStyle(f.win, f.actor, 10, f.shadow, f.padding);
    const replacement = shadowFixture().child;
    f.actor.firstChild = replacement;
    api.updateShadowActorStyle(f.win, f.actor, 10, f.shadow, f.padding);
    assert.equal(replacement.style, f.child.style);
    assert.equal(replacement.styleWrites, 1);
    assert.equal(replacement.redraws, 1);
    assert.equal(cssCalls(), 2);
});
