import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm';
import ts from 'typescript';

async function loadPatch(enabled) {
    class Clone {
        constructor(properties) {
            Object.assign(this, properties);
        }
        vfunc_allocate() {
            // The test only exercises construction and insertion.
        }
    }
    class LinearFilterEffect {}
    const constants = {
        OVERVIEW_SHADOW_ACTOR: 'overview-shadow',
        SHADOW_PADDING: 8,
    };
    const mocks = {
        'gi://Clutter': {default: {Clone}},
        'gi://GObject': {
            default: {registerClass: (_metadata, klass) => klass},
        },
        'gi://Graphene': {default: {Point: class Point {}}},
        'resource:///org/gnome/shell/ui/main.js': {overview: {}},
        '../effect/linear_filter_effect.js': {LinearFilterEffect},
        '../manager/utils.js': {
            getRoundedCornersEffect: () => ({enabled: true}),
        },
        '../utils/actor_lifetime.js': {
            getActorLifetime: () => ({active: true}),
        },
        '../utils/constants.js': constants,
        '../utils/log.js': {
            logDebug() {
                // No logging is needed for this focused test.
            },
        },
        '../utils/settings.js': {getPref: () => enabled},
    };
    const context = createContext({});
    const source = await readFile(
        new URL('../src/patch/add_shadow_in_overview.ts', import.meta.url),
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
        const values = mocks[specifier];
        return new SyntheticModule(
            Object.keys(values),
            function () {
                for (const [key, value] of Object.entries(values))
                    this.setExport(key, value);
            },
            {context},
        );
    });
    await module.evaluate();
    return module.namespace.addShadowInOverview;
}

for (const enabled of [true, false]) {
    test(`Overview shadow clone remains and filter follows preference (${enabled})`, async () => {
        const addShadowInOverview = await loadPatch(enabled);
        const effects = [];
        const inserted = [];
        const windowContainer = {
            firstChild: {add_effect: effect => effects.push(effect)},
            bind_property() {
                // The clone's scale binding is outside this test's scope.
            },
        };
        const preview = {
            windowContainer,
            insert_child_below: actor => inserted.push(actor),
        };
        const window = {
            get_transient_for: () => null,
            get_compositor_private: () => ({rwcCustomData: {shadow: {}}}),
            wmClass: 'test-window',
        };

        addShadowInOverview(window, preview);

        assert.equal(effects.length, enabled ? 1 : 0);
        assert.equal(inserted.length, 1);
        assert.equal(inserted[0].name, 'overview-shadow');
    });
}
