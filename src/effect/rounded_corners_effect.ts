/** @file Binds the actual corner rounding shader to the windows. */

import type {Bounds, RoundedCornerSettings} from '../utils/types.js';

import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

import {readShader} from '../utils/file.js';
import {getPref} from '../utils/settings.js';
import {ShaderEffect} from './shader_effect.js';

const [declarations, code] = await readShader(
    import.meta.url,
    'shader/rounded_corners.frag',
);

type UniformName =
    | 'bounds'
    | 'clipRadius'
    | 'borderWidth'
    | 'borderColor'
    | 'borderedAreaBounds'
    | 'borderedAreaClipRadius'
    | 'exponent'
    | 'pixelStep';

// A WeakMap is safe even if pipeline construction happens during super().
// Store copies: borderColor comes from mutable settings objects.
const uploadedUniforms = new WeakMap<
    InstanceType<typeof ShaderEffect>,
    Map<UniformName, number[]>
>();

export const RoundedCornersEffect = GObject.registerClass(
    {},
    class Effect extends ShaderEffect {
        vfunc_get_static_snippet() {
            uploadedUniforms.delete(this);
            return Cogl.Snippet.new(
                Cogl.SnippetHook.FRAGMENT,
                declarations,
                code,
            );
        }

        /**
         * Update uniforms of the shader.
         * For more information, see the comments in the shader file.
         *
         * @param config - Rounded corners configuration
         * @param windowBounds - Bounds of the window without padding
         */
        updateUniforms(config: RoundedCornerSettings, windowBounds: Bounds) {
            const borderWidth = getPref('border-width');
            const borderColor = config.borderColor;

            const outerRadius = config.borderRadius;
            const {padding, smoothing} = config;

            const bounds = [
                windowBounds.x1 + padding.left,
                windowBounds.y1 + padding.top,
                windowBounds.x2 - padding.right,
                windowBounds.y2 - padding.bottom,
            ];

            const borderedAreaBounds = [
                bounds[0] + borderWidth,
                bounds[1] + borderWidth,
                bounds[2] - borderWidth,
                bounds[3] - borderWidth,
            ];

            let borderedAreaRadius = outerRadius - borderWidth;
            if (borderedAreaRadius < 0.001) {
                borderedAreaRadius = 0.0;
            }

            const pixelStep = [
                1 / Math.max(1, this.actor.get_width()),
                1 / Math.max(1, this.actor.get_height()),
            ];

            // This is needed for squircle corners
            let exponent = smoothing * 10 + 2;
            let radius = outerRadius * 0.5 * exponent;
            const maxRadius = Math.max(
                0,
                Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]),
            );
            if (radius > maxRadius) {
                exponent *= maxRadius / radius;
                radius = maxRadius;
            }
            borderedAreaRadius *= outerRadius > 0 ? radius / outerRadius : 0;

            this.#setUniforms(
                bounds,
                radius,
                borderWidth,
                borderColor,
                borderedAreaBounds,
                borderedAreaRadius,
                pixelStep,
                exponent,
            );
        }

        #setUniforms(
            bounds: number[],
            radius: number,
            borderWidth: number,
            borderColor: [number, number, number, number],
            borderedAreaBounds: number[],
            borderedAreaRadius: number,
            pixelStep: number[],
            exponent: number,
        ) {
            const values: [UniformName, number[]][] = [
                ['bounds', bounds],
                ['clipRadius', [radius]],
                ['borderWidth', [borderWidth]],
                ['borderColor', borderColor],
                ['borderedAreaBounds', borderedAreaBounds],
                ['borderedAreaClipRadius', [borderedAreaRadius]],
                ['pixelStep', pixelStep],
                ['exponent', [exponent]],
            ];
            const previous =
                uploadedUniforms.get(this) ?? new Map<UniformName, number[]>();
            let changed = false;
            for (const [name, value] of values) {
                const oldValue = previous.get(name);
                if (oldValue?.every((component, i) => component === value[i]))
                    continue;
                this.set_uniform_float(name, value.length, value);
                previous.set(name, [...value]);
                changed = true;
            }
            uploadedUniforms.set(this, previous);
            if (changed) this.queue_repaint();
        }
    },
);
