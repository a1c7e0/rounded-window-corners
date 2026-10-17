/** Tracks pending work without reading native properties of disposed actors. */
import type Meta from 'gi://Meta';

export type ActorLifetime = {active: boolean};
const lifetimes = new WeakMap<Meta.WindowActor, ActorLifetime>();

export function beginActorLifetime(actor: Meta.WindowActor) {
    const lifetime = {active: true};
    lifetimes.set(actor, lifetime);
    return lifetime;
}

export function getActorLifetime(actor: Meta.WindowActor) {
    return lifetimes.get(actor);
}

export function endActorLifetime(actor: Meta.WindowActor) {
    const lifetime = lifetimes.get(actor);
    if (lifetime) lifetime.active = false;
    lifetimes.delete(actor);
}
