/*
 * Local modification, 2026-10-10: single-file daily journal support.
 * Distributed under the GNU General Public License, version 3 or later.
 */

import { MarkdownView, Platform, TFile, TFolder, normalizePath, type App, type PaneType } from 'obsidian';
import { strings } from '../i18n';
import { ConfirmModal } from '../modals/ConfirmModal';
import type { CommandQueueService } from '../services/CommandQueueService';
import type { NotebookNavigatorSettings } from '../settings/types';
import type { MomentApi, MomentInstance } from './moment';
import { showNotice } from './noticeUtils';
import { NOTEBOOK_NAVIGATOR_VIEW } from '../types';

type JournalSettings = Pick<NotebookNavigatorSettings, 'calendarSingleFilePath'>;
const pendingWrites = new WeakMap<App, Map<string, Promise<unknown>>>();
const openedListeners = new WeakMap<App, Set<(iso: string) => void>>();

export function subscribeSingleFileDailyNoteOpened(app: App, listener: (iso: string) => void): () => void {
    const listeners = openedListeners.get(app) ?? new Set();
    openedListeners.set(app, listeners);
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export interface SingleFileDailyNoteEntry {
    iso: string;
    line: number;
    content: string;
}

interface JournalSection {
    iso: string;
    line: number;
    offset: number;
    bodyOffset: number;
}

export function getSingleFileDailyNotePath(settings: JournalSettings): string {
    const raw = (settings.calendarSingleFilePath.trim() || '日记.md').replace(/\\/g, '/');
    const parts = raw.split('/');
    if (
        raw.startsWith('/') ||
        parts.some(
            part =>
                part === '.' ||
                part === '..' ||
                part.startsWith('.') ||
                /[<>:"|?*]/u.test(part) ||
                Array.from(part).some(character => character.charCodeAt(0) < 32)
        )
    ) {
        throw new Error(strings.settings.items.singleFileDailyNotes.invalidPath);
    }
    const path = normalizePath(parts.filter(Boolean).join('/'));
    return /\.md$/iu.test(path) ? path : `${path}.md`;
}

/** Only real, top-level date headings count. Examples in YAML, comments and fenced code are ignored. */
export function parseSingleFileDailyNoteHeadings(content: string): Map<string, number> {
    return scanJournal(content).headings;
}

export function isSingleFileDailyNoteDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function scanJournal(content: string): { headings: Map<string, number>; sections: JournalSection[]; canAppend: boolean } {
    const headings = new Map<string, number>();
    const sections: JournalSection[] = [];
    const lines = content.split('\n');
    let frontmatter = lines[0].replace(/^\uFEFF/u, '').replace(/\r$/u, '') === '---';
    let fence: { character: string; length: number } | null = null;
    let comment = false;
    let offset = 0;
    for (const [index, rawLine] of lines.entries()) {
        const lineOffset = offset;
        offset += rawLine.length + 1;
        const normalizedLine = rawLine.replace(/\r$/u, '');
        const line = index === 0 ? normalizedLine.replace(/^\uFEFF/u, '') : normalizedLine;
        if (frontmatter) {
            if (index > 0 && /^(---|\.\.\.)\s*$/u.test(line)) frontmatter = false;
            continue;
        }
        if (!fence && (comment || /^ {0,3}<!--/u.test(line))) {
            comment = !line.includes('-->');
            continue;
        }
        const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
        if (fenceMatch) {
            const marker = fenceMatch[1];
            if (!fence && !(marker[0] === '`' && fenceMatch[2].includes('`'))) {
                fence = { character: marker[0], length: marker.length };
            } else if (fence && marker[0] === fence.character && marker.length >= fence.length && !fenceMatch[2].trim()) {
                fence = null;
            }
            continue;
        }
        if (fence) continue;
        const match = /^ {0,3}#[\t ]+(\d{4}-\d{2}-\d{2})(?:[\t ]+#+)?[\t ]*$/u.exec(line);
        if (match && isSingleFileDailyNoteDate(match[1])) {
            if (!headings.has(match[1])) headings.set(match[1], index);
            sections.push({
                iso: match[1],
                line: index,
                offset: lineOffset + (index === 0 && rawLine.startsWith('\uFEFF') ? 1 : 0),
                bodyOffset: Math.min(offset, content.length)
            });
        }
    }
    return { headings, sections, canAppend: !frontmatter && !fence && !comment };
}

/** Date sections keep their complete Markdown bodies; the preamble stays at the beginning. */
export function getSingleFileDailyNoteEntries(content: string): SingleFileDailyNoteEntry[] {
    const { sections } = scanJournal(content);
    return sections.map((section, index) => ({
        iso: section.iso,
        line: section.line,
        content: content.slice(section.bodyOffset, sections[index + 1]?.offset ?? content.length)
    }));
}

export function sortSingleFileDailyNotes(content: string): string {
    const { sections, canAppend } = scanJournal(content);
    if (!canAppend) throw new Error(strings.settings.items.singleFileDailyNotes.incompleteMarkdown);
    const sorted = [...sections].sort((a, b) => a.iso.localeCompare(b.iso));
    if (sorted.every((section, index) => section === sections[index])) return content;
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const blocks = new Map(
        sections.map((section, index) => [section, content.slice(section.offset, sections[index + 1]?.offset ?? content.length)])
    );
    return (
        content.slice(0, sections[0].offset) +
        sorted
            .map((section, index) => {
                const block = blocks.get(section) ?? '';
                return index < sorted.length - 1 && !block.endsWith('\n') ? block + newline.repeat(2) : block;
            })
            .join('')
    );
}

export function appendSingleFileDailyNote(content: string, iso: string): { content: string; line: number } {
    if (!isSingleFileDailyNoteDate(iso)) throw new Error('Invalid journal date');
    const scan = scanJournal(content);
    const existingLine = scan.headings.get(iso);
    if (existingLine !== undefined) {
        const sorted = scan.canAppend ? sortSingleFileDailyNotes(content) : content;
        return { content: sorted, line: parseSingleFileDailyNoteHeadings(sorted).get(iso) ?? existingLine };
    }
    if (!scan.canAppend) throw new Error(strings.settings.items.singleFileDailyNotes.incompleteMarkdown);
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const separator = !content || content.endsWith(`${newline}${newline}`) ? '' : content.endsWith(newline) ? newline : newline.repeat(2);
    const prefix = content + separator;
    const sorted = sortSingleFileDailyNotes(`${prefix}# ${iso}${newline}${newline}`);
    return { content: sorted, line: parseSingleFileDailyNoteHeadings(sorted).get(iso) ?? 0 };
}

/** Serializes creation as well as atomic vault.process writes, including rapid clicks on different dates. */
export async function ensureSingleFileDailyNote(
    app: App,
    date: MomentInstance,
    settings: JournalSettings
): Promise<{ file: TFile; line: number; iso: string }> {
    const path = getSingleFileDailyNotePath(settings);
    const iso = date.clone().locale('en').format('YYYY-MM-DD');
    let queue = pendingWrites.get(app);
    if (!queue) {
        queue = new Map();
        pendingWrites.set(app, queue);
    }
    const previous = queue.get(path) ?? Promise.resolve();
    const operation = previous
        .catch(() => {})
        .then(async () => {
            const existing = app.vault.getAbstractFileByPath(path);
            if (!existing) {
                const parts = path.split('/');
                parts.pop();
                let folderPath = '';
                for (const part of parts) {
                    folderPath = folderPath ? `${folderPath}/${part}` : part;
                    const folder = app.vault.getAbstractFileByPath(folderPath);
                    if (folder && !(folder instanceof TFolder)) throw new Error(`Folder path is occupied: ${folderPath}`);
                    if (!folder) await app.vault.createFolder(folderPath);
                }
                const initial = appendSingleFileDailyNote('', iso);
                const created = await app.vault.create(path, initial.content);
                return { file: created, line: initial.line, iso };
            }
            if (!(existing instanceof TFile) || existing.extension.toLowerCase() !== 'md') {
                throw new Error(strings.settings.items.singleFileDailyNotes.invalidPath);
            }
            let line = 0;
            await app.vault.process(existing, content => {
                const result = appendSingleFileDailyNote(content, iso);
                line = result.line;
                return result.content;
            });
            return { file: existing, line, iso };
        });
    queue.set(path, operation);
    try {
        return await operation;
    } finally {
        if (queue.get(path) === operation) queue.delete(path);
    }
}

/** Resolves the date section containing the active editor cursor, instead of treating every date as active. */
export function getActiveSingleFileDailyNoteDate(app: App, settings: JournalSettings, momentApi: MomentApi): MomentInstance | null {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return null;
    try {
        if (view.file.path !== getSingleFileDailyNotePath(settings)) return null;
    } catch {
        return null;
    }
    const cursorLine = view.editor.getCursor().line;
    let activeIso: string | null = null;
    for (const [iso, line] of parseSingleFileDailyNoteHeadings(view.editor.getValue())) {
        if (line > cursorLine) break;
        activeIso = iso;
    }
    return activeIso ? momentApi(activeIso, 'YYYY-MM-DD', 'en', true).startOf('day') : null;
}

interface JournalOpenOptions {
    context?: PaneType;
    commandQueue?: CommandQueueService | null;
    canOpen?: () => boolean;
    onOpened?: () => void;
}

export async function openSingleFileDailyNote(
    app: App,
    date: MomentInstance,
    settings: Pick<NotebookNavigatorSettings, 'calendarSingleFilePath' | 'calendarConfirmBeforeCreate'>,
    options: JournalOpenOptions = {}
): Promise<void> {
    try {
        if (options.canOpen && !options.canOpen()) return;
        const path = getSingleFileDailyNotePath(settings);
        const iso = date.clone().locale('en').format('YYYY-MM-DD');
        const existing = app.vault.getAbstractFileByPath(path);
        const hasEntry = existing instanceof TFile && parseSingleFileDailyNoteHeadings(await app.vault.cachedRead(existing)).has(iso);
        const open = async () => {
            if (options.canOpen && !options.canOpen()) return;
            const entry = await ensureSingleFileDailyNote(app, date, settings);
            const context = Platform.isMobile && options.context === 'window' ? 'tab' : options.context;
            const getLeaf = () => app.workspace.getLeaf(context ?? false);
            const openInLeaf = async () => {
                const leaf = getLeaf();
                await leaf.openFile(entry.file, { active: true, eState: { line: entry.line, subpath: `#${entry.iso}` } });
                if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'source') {
                    const cursor = { line: entry.line, ch: 0 };
                    leaf.view.editor.setCursor(cursor);
                    leaf.view.editor.scrollIntoView({ from: cursor, to: cursor }, true);
                }
                if (!Platform.isMobile) {
                    try {
                        let navigatorLeaf = app.workspace.getLeavesOfType(NOTEBOOK_NAVIGATOR_VIEW)[0];
                        if (!navigatorLeaf) {
                            const newLeaf = app.workspace.getLeftLeaf(false);
                            if (newLeaf) {
                                await newLeaf.setViewState({ type: NOTEBOOK_NAVIGATOR_VIEW, active: false });
                                navigatorLeaf = newLeaf;
                            }
                        }
                        if (navigatorLeaf) {
                            await app.workspace.revealLeaf(navigatorLeaf);
                            app.workspace.setActiveLeaf(leaf, { focus: true });
                        }
                    } catch (error) {
                        console.error('Failed to reveal journal previews', error);
                    }
                }
                openedListeners.get(app)?.forEach(listener => listener(entry.iso));
                options.onOpened?.();
            };
            if (options.commandQueue && context) {
                const result = await options.commandQueue.executeOpenInNewContext(entry.file, context, openInLeaf);
                if (!result.success) throw result.error ?? new Error(strings.settings.items.singleFileDailyNotes.failed);
            } else if (options.commandQueue) {
                const result = await options.commandQueue.executeOpenActiveFile(entry.file, openInLeaf, { active: true, getLeaf });
                if (!result.success) throw result.error ?? new Error(strings.settings.items.singleFileDailyNotes.failed);
            } else {
                await openInLeaf();
            }
        };
        if (!hasEntry && settings.calendarConfirmBeforeCreate) {
            new ConfirmModal(
                app,
                strings.settings.items.singleFileDailyNotes.createTitle,
                strings.settings.items.singleFileDailyNotes.createMessage.replace('{date}', iso).replace('{path}', path),
                () => {
                    void open().catch(error => {
                        console.error('Failed to open journal entry', error);
                        showNotice(strings.settings.items.singleFileDailyNotes.failed);
                    });
                },
                strings.navigationCalendar.createDailyNote.confirmButton,
                { confirmButtonClass: 'mod-cta' }
            ).open();
        } else {
            await open();
        }
    } catch (error) {
        console.error('Failed to open journal entry', error);
        showNotice(error instanceof Error ? error.message : strings.settings.items.singleFileDailyNotes.failed);
    }
}
