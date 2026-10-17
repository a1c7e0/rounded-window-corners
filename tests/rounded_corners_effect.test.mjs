import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm';
import ts from 'typescript';

async function effect(settings = {borderWidth: 0}) {
    class GLSLEffect {
        actor = {get_width: () => 0, get_height: () => 0};
        values = new Map();
        uploads = [];
        repaints = 0;
        get_uniform_location(name) {
            return name;
        }
        set_uniform_float(name, _length, value) {
            this.values.set(name, [...value]);
            this.uploads.push(name);
        }
        queue_repaint() {
            this.repaints++;
        }
        add_glsl_snippet() {
            /* No GPU required by these numeric regression tests. */
        }
    }
    const context = createContext({});
    const mocks = {
        'gi://Cogl': {
            default: {SnippetHook: {FRAGMENT: 0}, Snippet: {new: () => ({})}},
        },
        'gi://GObject': {default: {registerClass: (_metadata, klass) => klass}},
        './shader_effect.js': {ShaderEffect: GLSLEffect},
        '../utils/file.js': {readShader: async () => ['', '']},
        '../utils/settings.js': {getPref: () => settings.borderWidth},
    };
    const source = await readFile(
        new URL('../src/effect/rounded_corners_effect.ts', import.meta.url),
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
    const instance = new module.namespace.RoundedCornersEffect();
    instance.createPeer = () => new module.namespace.RoundedCornersEffect();
    return instance;
}

function config(radius) {
    return {
        borderRadius: radius,
        borderColor: [0, 0, 0, 0],
        smoothing: 1,
        padding: {left: 0, right: 0, top: 0, bottom: 0},
    };
}

test('oversized squircle radius is constrained by the smaller window dimension', async () => {
    const shader = await effect();
    shader.updateUniforms(config(100), {x1: 10, y1: 20, x2: 50, y2: 100});
    assert.equal(shader.values.get('clipRadius')[0], 40);
});

test('zero radius and zero surface size never upload NaN or infinite uniforms', async () => {
    const shader = await effect();
    shader.updateUniforms(config(0), {x1: 0, y1: 0, x2: 0, y2: 0});
    for (const values of shader.values.values())
        for (const value of values) assert.ok(Number.isFinite(value));
});

test('identical updates do not upload uniforms or request another repaint', async () => {
    const shader = await effect();
    const cfg = config(15);
    const bounds = {x1: 0, y1: 0, x2: 800, y2: 600};
    shader.updateUniforms(cfg, bounds);
    assert.equal(shader.uploads.length, 8);
    for (let i = 0; i < 100; i++) shader.updateUniforms(cfg, bounds);
    assert.equal(shader.uploads.length, 8);
    assert.equal(shader.repaints, 1);
});

test('in-place color changes upload only the changed uniform', async () => {
    const shader = await effect();
    const cfg = config(15);
    const bounds = {x1: 0, y1: 0, x2: 800, y2: 600};
    shader.updateUniforms(cfg, bounds);
    shader.uploads.length = 0;
    cfg.borderColor[0] = 0.5;
    shader.updateUniforms(cfg, bounds);
    assert.deepEqual(shader.uploads, ['borderColor']);
    assert.equal(shader.repaints, 2);
});

test('surface size and border setting changes still update the shader', async () => {
    const settings = {borderWidth: 0};
    const shader = await effect(settings);
    const cfg = config(15);
    const bounds = {x1: 0, y1: 0, x2: 800, y2: 600};
    shader.updateUniforms(cfg, bounds);
    shader.uploads.length = 0;
    shader.actor.get_width = () => 400;
    shader.updateUniforms(cfg, bounds);
    assert.deepEqual(shader.uploads, ['pixelStep']);
    shader.uploads.length = 0;
    settings.borderWidth = 2;
    shader.updateUniforms(cfg, bounds);
    assert.ok(shader.uploads.includes('borderWidth'));
    assert.ok(shader.uploads.includes('borderedAreaBounds'));
    assert.ok(shader.uploads.includes('borderedAreaClipRadius'));
});

test('reinitializing the shader snippet invalidates the upload snapshot', async () => {
    const shader = await effect();
    const cfg = config(15);
    const bounds = {x1: 0, y1: 0, x2: 800, y2: 600};
    shader.updateUniforms(cfg, bounds);
    shader.vfunc_get_static_snippet();
    shader.updateUniforms(cfg, bounds);
    assert.equal(shader.uploads.length, 16);
    assert.equal(shader.repaints, 2);
});

test('each effect instance uploads its own initial uniforms', async () => {
    const first = await effect();
    const second = first.createPeer();
    const cfg = config(15);
    const bounds = {x1: 0, y1: 0, x2: 800, y2: 600};
    first.updateUniforms(cfg, bounds);
    second.updateUniforms(cfg, bounds);
    assert.equal(first.uploads.length, 8);
    assert.equal(second.uploads.length, 8);
});
