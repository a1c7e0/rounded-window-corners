# GNOME Shell 51

This branch targets GNOME Shell 51. GNOME 50 is not declared supported because
its shader API differs.

## Native API changes

GNOME Shell [removed Shell.GLSLEffect](https://gitlab.gnome.org/GNOME/gnome-shell/-/commit/30f545eb00468e3df317bc725da01fc76ac5b582).
Rounded corners, shadow clipping and the optional preview filter now subclass
`Clutter.ShaderEffect`, supply a `Cogl.Snippet` through
`vfunc_get_static_snippet`, and set uniforms by name.

The published `@girs/gnome-shell` resource typings currently target Shell 50.
`src/effect/shader_effect.ts` narrowly describes the native 51 uniform setter;
it does not restore removed runtime APIs or suppress project type checking.

## Validation

The fork has been tested with real GNOME Shell **51.1**, a virtual display and
Mesa software rendering, on both Wayland and XWayland test windows:

- Creating windows and applying the actual native effects.
- Opening and closing Overview with the extra filter enabled and disabled.
- Resizing, minimizing and restoring a window.
- Switching workspaces in both directions.
- Closing windows, disabling and re-enabling the extension, and creating new
  windows after re-enabling.
- Removing effect state on disable.

The runner rejects Shell JavaScript/critical errors, disposed-actor errors and
offscreen framebuffer failures. Desktop services unavailable inside the test
session may produce unrelated portal/accessibility warnings.

To reproduce after building with `just build`:

```sh
npm run check
npm test
glib-compile-schemas --strict _build/schemas
tests/run-gnome51-smoke.sh wayland
tests/run-gnome51-smoke.sh x11
```

Native tests use a private D-Bus session, temporary XDG directories, an in-memory
GSettings backend and a headless compositor. They do not install the extension
or change the current desktop settings. The X11 run needs XWayland installed.
A Mesa EGL vendor is selected for the software-rendered test when available,
keeping it independent of an installed NVIDIA EGL vendor.

These tests verify runtime behavior, not Intel/NVIDIA hardware frame timing,
multi-monitor rendering or a specific percentage speedup.

## Install

This fork is maintained by **a1c7e0** and uses the UUID
`rounded-window-corners@a1c7e0`. When migrating from the upstream UUID, disable
it first so the two variants do not run together:

```sh
gnome-extensions disable rounded-window-corners@fxgn
```

Existing preferences are retained because the settings schema and path are
unchanged. The upstream gettext domain is retained for existing translations.

Install a built extension ZIP from this fork:

```sh
gnome-extensions install --force /absolute/path/rounded-window-corners@a1c7e0.shell-extension.zip
```

Or build and install from this repository, with Node.js, npm, gettext and just:

```sh
just install
```

This writes to `~/.local/share/gnome-shell/extensions/rounded-window-corners@a1c7e0`.
Log out and back in before enabling the new version, particularly when another
version was loaded earlier in the same session: GJS keeps registered classes
and imported modules in memory even after uninstalling files.

```sh
gnome-extensions enable rounded-window-corners@a1c7e0
```

The extra filter defaults to on to preserve the appearance. Disable **Improve
overview preview scaling** under **Tweaks** to compare the lighter rendering
path. No restart is needed for this setting; reopen Overview.
