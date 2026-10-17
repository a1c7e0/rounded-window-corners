/** GNOME 51 ShaderEffect API bridge until Shell 51 typings are published. */
import type GObject from 'gi://GObject';

import Clutter from 'gi://Clutter';

// Shell's published resource typings still target 50. The native 51 API uses
// uniform names, not GLSLEffect's integer locations. Keep this bridge narrow.
type ShaderEffectInstance = Clutter.OffscreenEffect & {
    // biome-ignore lint/style/useNamingConvention: Native GNOME 51 GI method name.
    set_uniform_float: (
        name: string,
        components: number,
        values: number[],
    ) => void;
};

export const ShaderEffect = Clutter.ShaderEffect as unknown as {
    new (): ShaderEffectInstance;
    $gtype: GObject.GType;
};
