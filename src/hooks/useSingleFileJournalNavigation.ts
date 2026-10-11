/* Local modification, 2026-10-11. GNU GPL version 3 or later. */
import { useCallback, useEffect, useState } from 'react';
import type { App } from 'obsidian';
import type { NotebookNavigatorSettings } from '../settings/types';
import { getSingleFileDailyNotePath, subscribeSingleFileDailyNoteOpened } from '../utils/singleFileDailyNotes';

export function useSingleFileJournalNavigation(app: App, settings: NotebookNavigatorSettings) {
    let path: string | null = null;
    try {
        path = getSingleFileDailyNotePath(settings);
    } catch {
        /* Invalid paths are reported when opened. */
    }
    const enabled = settings.calendarIntegrationMode === 'single-file' && path !== null;
    const [visible, setVisible] = useState(() => enabled && app.workspace.getActiveFile()?.path === path);
    useEffect(() => {
        setVisible(enabled && app.workspace.getActiveFile()?.path === path);
        const ref = app.workspace.on('file-open', file => {
            // Focusing a sidebar can emit null; keep the current journal list and its search state.
            if (file) setVisible(enabled && file.path === path);
        });
        const unsubscribe = subscribeSingleFileDailyNoteOpened(app, () => {
            if (enabled) setVisible(true);
        });
        return () => {
            app.workspace.offref(ref);
            unsubscribe();
        };
    }, [app, enabled, path]);
    const close = useCallback(() => setVisible(false), []);
    return { visible: enabled && visible, close };
}
