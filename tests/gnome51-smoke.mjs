// Run only inside a private headless GNOME Shell 51 session; see README.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

function check(value, message) {
    if (!value) throw new Error(message);
}
export async function run() {
    const root = GLib.getenv('RWC_TEST_EXTENSION');
    const file = Gio.File.new_for_path(`${root}/metadata.json`);
    const [, bytes] = file.load_contents(null);
    const metadata = JSON.parse(new TextDecoder().decode(bytes));
    const {default: Extension} = await import(`file://${root}/extension.js`);
    const extension = new Extension({
        ...metadata,
        path: root,
        dir: Gio.File.new_for_path(root),
    });
    extension.getSettings().set_boolean('skip-libadwaita-app', false);
    extension.enable();
    await Scripting.createTestWindow({width: 640, height: 480});
    await Scripting.createTestWindow({width: 400, height: 300});
    await Scripting.waitTestWindows();
    await Scripting.sleep(700);
    let actors = global.get_window_actors().filter(a => a.rwcCustomData);
    check(actors.length >= 2, 'Expected rounded effects on two test windows');
    if (GLib.getenv('RWC_TEST_BACKEND') === 'x11')
        check(
            actors.every(
                a =>
                    a.metaWindow.get_client_type() ===
                    Meta.WindowClientType.X11,
            ),
            'Expected XWayland test windows',
        );
    for (const filter of [true, false]) {
        extension.getSettings().set_boolean('overview-linear-filter', filter);
        Main.overview.show();
        // biome-ignore lint/performance/noAwaitInLoops: Test animations sequentially.
        await Scripting.sleep(600);
        Main.overview.hide();
        await Scripting.sleep(600);
    }
    const workspace = global.workspace_manager.get_active_workspace();
    const next = global.workspace_manager.get_workspace_by_index(
        workspace.index() + 1,
    );
    if (next) {
        Main.wm.actionMoveWorkspace(next);
        await Scripting.sleep(650);
        Main.wm.actionMoveWorkspace(workspace);
        await Scripting.sleep(650);
    }
    const window = actors[0].metaWindow;
    window.move_resize_frame(false, 30, 30, 720, 500);
    await Scripting.sleep(350);
    window.minimize();
    await Scripting.sleep(350);
    window.unminimize();
    await Scripting.sleep(650);
    await Scripting.destroyTestWindows();
    await Scripting.sleep(400);
    extension.disable();
    extension.enable();
    await Scripting.createTestWindow({width: 500, height: 320});
    await Scripting.waitTestWindows();
    await Scripting.sleep(600);
    actors = global.get_window_actors().filter(a => a.rwcCustomData);
    check(actors.length > 0, 'Re-enable did not create effects');
    extension.disable();
    check(
        !global.get_window_actors().some(a => a.rwcCustomData),
        'Disable leaked window effects',
    );
    await Scripting.destroyTestWindows();
    print('RWC_GNOME51_SMOKE_PASS');
}
