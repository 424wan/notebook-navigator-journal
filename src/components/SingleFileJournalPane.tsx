/* Local modification, 2026-10-11. GNU GPL version 3 or later. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownView, TFile } from 'obsidian';
import { useServices } from '../context/ServicesContext';
import { useSettingsState } from '../context/SettingsContext';
import { strings } from '../i18n';
import {
    getActiveSingleFileDailyNoteDate,
    getSingleFileDailyNoteEntries,
    getSingleFileDailyNotePath,
    openSingleFileDailyNote,
    subscribeSingleFileDailyNoteOpened
} from '../utils/singleFileDailyNotes';
import { getMomentApi } from '../utils/moment';
import { PreviewTextUtils } from '../utils/previewTextUtils';
import { runAsyncAction } from '../utils/async';

export interface JournalPreviewCard {
    iso: string;
    line: number;
    preview: string;
}

export function JournalEntryCards({
    entries,
    activeIso,
    onOpen
}: {
    entries: JournalPreviewCard[];
    activeIso: string | null;
    onOpen: (iso: string) => void;
}) {
    const labels = strings.settings.items.singleFileDailyNotes;
    return (
        <ul className="nn-journal-cards">
            {entries.map(entry => (
                <li key={`${entry.iso}:${entry.line}`}>
                    <button
                        type="button"
                        className={`nn-journal-entry${entry.iso === activeIso ? ' is-selected' : ''}`}
                        aria-pressed={entry.iso === activeIso}
                        onClick={() => onOpen(entry.iso)}
                    >
                        <span className="nn-journal-entry-date">{entry.iso}</span>
                        <span className="nn-journal-entry-preview">{entry.preview || labels.noEntryContent}</span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

export function SingleFileJournalPane({
    onClose,
    resizeHandleProps
}: {
    onClose: () => void;
    resizeHandleProps?: { onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void };
}) {
    const { app, commandQueue } = useServices();
    const settings = useSettingsState();
    const labels = strings.settings.items.singleFileDailyNotes;
    const path = getSingleFileDailyNotePath(settings);
    const [content, setContent] = useState('');
    const [activeIso, setActiveIso] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [newestFirst, setNewestFirst] = useState(true);
    const [failed, setFailed] = useState(false);
    const latestSettings = useRef(settings);
    latestSettings.current = settings;

    useEffect(() => {
        let mounted = true;
        let generation = 0;
        let timer: number | null = null;
        const refresh = async () => {
            const currentGeneration = ++generation;
            try {
                const file = app.vault.getAbstractFileByPath(path);
                const view = app.workspace.getActiveViewOfType(MarkdownView);
                const text =
                    view?.file?.path === path ? view.editor.getValue() : file instanceof TFile ? await app.vault.cachedRead(file) : '';
                if (!mounted || currentGeneration !== generation) return;
                setContent(text);
                setFailed(false);
                const momentApi = getMomentApi();
                if (momentApi) {
                    setActiveIso(getActiveSingleFileDailyNoteDate(app, latestSettings.current, momentApi)?.format('YYYY-MM-DD') ?? null);
                }
            } catch (error) {
                if (mounted && currentGeneration === generation) setFailed(true);
                console.error('Failed to load journal previews', error);
            }
        };
        const schedule = () => {
            if (timer) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                timer = null;
                void refresh();
            }, 150);
        };
        const refs = [
            app.vault.on('modify', file => {
                if (file.path === path) schedule();
            }),
            app.vault.on('delete', file => {
                if (file.path === path) schedule();
            }),
            app.vault.on('rename', (file, oldPath) => {
                if (file.path === path || oldPath === path) schedule();
            })
        ];
        const editorRef = app.workspace.on('editor-change', (_editor, view) => {
            if (view.file?.path === path) schedule();
        });
        const unsubscribe = subscribeSingleFileDailyNoteOpened(app, iso => {
            setActiveIso(iso);
            void refresh();
        });
        void refresh();
        return () => {
            mounted = false;
            generation++;
            if (timer) window.clearTimeout(timer);
            refs.forEach(ref => app.vault.offref(ref));
            app.workspace.offref(editorRef);
            unsubscribe();
        };
    }, [app, path]);

    const entries = useMemo(
        () =>
            getSingleFileDailyNoteEntries(content).map(entry => ({
                ...entry,
                preview: PreviewTextUtils.extractPreviewText(entry.content, { ...settings, previewProperties: [] })
            })),
        [content, settings]
    );
    const displayedEntries = useMemo(() => {
        const search = query.trim().toLocaleLowerCase();
        return entries
            .filter(entry => !search || `${entry.iso}\n${entry.content}`.toLocaleLowerCase().includes(search))
            .sort((a, b) => (newestFirst ? b.iso.localeCompare(a.iso) : a.iso.localeCompare(b.iso)));
    }, [entries, newestFirst, query]);
    const handleOpen = useCallback(
        (iso: string) => {
            const momentApi = getMomentApi();
            if (momentApi) {
                runAsyncAction(() => openSingleFileDailyNote(app, momentApi(iso, 'YYYY-MM-DD', 'en', true), settings, { commandQueue }));
            }
        },
        [app, commandQueue, settings]
    );

    return (
        <div className="nn-list-pane nn-journal-pane">
            {resizeHandleProps && <div className="nn-resize-handle" {...resizeHandleProps} />}
            <div className="nn-journal-header">
                <button
                    type="button"
                    className="clickable-icon"
                    aria-label={labels.backToFiles}
                    title={labels.backToFiles}
                    onClick={onClose}
                >
                    ←
                </button>
                <strong className="nn-journal-title">{path.split('/').pop()?.replace(/\.md$/iu, '')}</strong>
                <span className="nn-journal-count">{labels.entryCount.replace('{count}', String(entries.length))}</span>
            </div>
            <div className="nn-journal-controls">
                <input
                    type="search"
                    value={query}
                    aria-label={labels.searchEntries}
                    placeholder={labels.searchEntries}
                    onChange={event => setQuery(event.target.value)}
                />
                <button type="button" onClick={() => setNewestFirst(value => !value)}>
                    {newestFirst ? labels.newestFirst : labels.oldestFirst}
                </button>
            </div>
            <div className="nn-journal-scroll">
                {failed ? (
                    <p className="nn-journal-empty">{labels.failed}</p>
                ) : displayedEntries.length === 0 ? (
                    <p className="nn-journal-empty">{query.trim() ? labels.noSearchResults : labels.emptyEntries}</p>
                ) : (
                    <JournalEntryCards entries={displayedEntries} activeIso={activeIso} onOpen={handleOpen} />
                )}
            </div>
        </div>
    );
}
