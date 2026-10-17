/**
 * @file Manages connections between gnome shell events and the rounded corners
 * effect. See {@link enableEffect} for more information.
 */

import type GObject from 'gi://GObject';
import type Meta from 'gi://Meta';
import type Shell from 'gi://Shell';

import GLib from 'gi://GLib';

import {beginActorLifetime, endActorLifetime} from '../utils/actor_lifetime.js';
import {logDebug} from '../utils/log.js';
import {prefs} from '../utils/settings.js';
import {hasMetaWindow, type RoundedWindowActor} from '../utils/types.js';
import * as handlers from './event_handlers.js';

/**
 * The rounded corners effect has to perform some actions when differen events
 * happen. For example, when a new window is opened, the effect has to detect
 * it and add rounded corners to it.
 *
 * The `enableEffect` method handles this by attaching the necessary signals
 * to matching handlers on each effect.
 */
export function enableEffect() {
    // Update the effect when settings are changed.
    connect(prefs, 'changed', handlers.onSettingsChanged);

    const wm = global.windowManager;

    // Add the effect to all windows when the extension is enabled.
    const windowActors = global.get_window_actors();
    logDebug(`Initial window count: ${windowActors.length}`);
    for (const actor of windowActors) {
        if (hasMetaWindow(actor)) {
            applyEffectTo(actor);
        }
    }

    // Add the effect to new windows when they are opened.
    connect(
        global.display,
        'window-created',
        (_: Meta.Display, win: Meta.Window) => {
            const actor =
                win.get_compositor_private() as Meta.WindowActor | null;
            if (actor && hasMetaWindow(actor)) applyEffectTo(actor);
        },
    );

    // Window minimized.
    connect(wm, 'minimize', (_: Shell.WM, actor: Meta.WindowActor) => {
        if (hasMetaWindow(actor)) handlers.onMinimize(actor);
    });

    // Window unminimized.
    connect(wm, 'unminimize', (_: Shell.WM, actor: Meta.WindowActor) => {
        if (hasMetaWindow(actor)) handlers.onUnminimize(actor);
    });

    // When closing the window, remove the effect from it.
    connect(wm, 'destroy', (_: Shell.WM, actor: Meta.WindowActor) =>
        removeEffectFrom(actor),
    );

    // When windows are restacked, the order of shadow actors as well.
    connect(global.display, 'restacked', handlers.onRestacked);
}

/** Disable the effect for all windows. */
export function disableEffect() {
    for (const actor of actors.keys()) {
        removeEffectFrom(actor);
    }

    disconnectAll();
}

type ActorState = {
    objects: Set<GObject.Object>;
    sourceId: number;
    ready: boolean;
    running: boolean;
    dirty: boolean;
    shadowDirty: boolean;
};
const actors = new Map<RoundedWindowActor, ActorState>();

/** Coalesce actor/texture notifications and never modify effects mid-paint. */
function queueUpdate(actor: RoundedWindowActor, state: ActorState) {
    if (state.sourceId || state.running) return;
    state.sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        state.sourceId = 0;
        if (actors.get(actor) !== state || !actor.metaWindow)
            return GLib.SOURCE_REMOVE;
        if (!state.ready) {
            if (
                !(actor.firstChild && actor.get_texture()) ||
                actor.metaWindow.wmClass === null
            )
                return GLib.SOURCE_REMOVE;
            state.ready = true;
            const texture = actor.get_texture();
            if (texture) {
                state.objects.add(texture);
                connect(texture, 'size-changed', () => {
                    state.dirty = true;
                    queueUpdate(actor, state);
                });
            }
        }
        const update = state.dirty;
        state.dirty = false;
        state.shadowDirty = false;
        state.running = true;
        const work = update
            ? handlers.onSizeChanged(actor)
            : handlers.onFocusChanged(actor);
        Promise.resolve(work)
            .catch(logError)
            .finally(() => {
                state.running = false;
                if (
                    actors.get(actor) === state &&
                    (state.dirty || state.shadowDirty)
                )
                    queueUpdate(actor, state);
            });
        return GLib.SOURCE_REMOVE;
    });
}

const connections: {object: GObject.Object; id: number}[] = [];

/**
 * Connect a callback to an object signal and add it to the list of all
 * connections. This allows to easily disconnect all signals when removing
 * the effect.
 *
 * @param object - The object to connect the callback to.
 * @param signal - The name of the signal.
 * @param callback - The function to connect to the signal.
 */
function connect(
    object: GObject.Object,
    signal: string,
    // biome-ignore lint/suspicious/noExplicitAny: Signal callbacks can have any return args and return types.
    callback: (...args: any[]) => any,
) {
    connections.push({
        object,
        id: object.connect(signal, callback),
    });
}

/**
 * Disconnect all connected signals from all actors or a specific object.
 * Pruning disconnected entries keeps the array from growing unboundedly as
 * windows are opened and closed over the lifetime of the session.
 *
 * @param object - If object is provided, only disconnect signals from it.
 */
function disconnectAll(object?: GObject.Object | null) {
    if (object === null) return;
    let i = connections.length;
    while (i--) {
        const connection = connections[i];
        if (object === undefined || connection.object === object) {
            connection.object.disconnect(connection.id);
            // Over time as windows open and close, connections would grow
            // indefinitely with stale entries pointing to dead window objects
            // Release the reference to the GObject so it can be garbage
            // collected after the window is closed, preventing a memory leak.
            connections.splice(i, 1);
        }
    }
}

/**
 * Apply the effect to a window.
 *
 * While {@link enableEffect} handles global events such as window creation,
 * this function handles events that happen to a specific window, like changing
 * its size or workspace.
 *
 * @param actor - The window actor to apply the effect to.
 */
function applyEffectTo(actor: RoundedWindowActor) {
    if (actors.has(actor)) return;
    const win = actor.metaWindow;
    if (!win) return;

    beginActorLifetime(actor);
    const state: ActorState = {
        objects: new Set([actor, win]),
        sourceId: 0,
        ready: false,
        running: false,
        dirty: true,
        shadowDirty: false,
    };
    actors.set(actor, state);
    function resize() {
        state.dirty = true;
        queueUpdate(actor, state);
    }
    function focus() {
        state.shadowDirty = true;
        queueUpdate(actor, state);
    }
    connect(actor, 'destroy', () => removeEffectFrom(actor));
    connect(win, 'unmanaged', () => removeEffectFrom(actor));
    connect(actor, 'notify::first-child', resize);
    connect(win, 'notify::wm-class', resize);
    connect(actor, 'notify::size', resize);
    connect(win, 'notify::fullscreen', resize);
    connect(win, 'notify::appears-focused', focus);
    connect(win, 'workspace-changed', focus);
    queueUpdate(actor, state);
}

/**
 * Remove the effect from a window.
 *
 * @param actor - The window actor to remove the effect from.
 */
function removeEffectFrom(actor: Meta.WindowActor) {
    const state = actors.get(actor as RoundedWindowActor);
    if (!state) return;
    actors.delete(actor as RoundedWindowActor);
    endActorLifetime(actor);
    if (state.sourceId) GLib.source_remove(state.sourceId);
    for (const object of state.objects) disconnectAll(object);
    if (hasMetaWindow(actor)) handlers.onRemoveEffect(actor);
}
