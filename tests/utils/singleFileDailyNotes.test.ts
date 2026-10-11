import { App, MarkdownView, TFile, TFolder, type Command } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type NotebookNavigatorPlugin from '../../src/main';
import registerNavigatorCommands from '../../src/services/commands/navigatorCommandHandlers';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import { resetMomentApiCacheForTests } from '../../src/utils/moment';
import { showNotice } from '../../src/utils/noticeUtils';
import {
    appendSingleFileDailyNote,
    ensureSingleFileDailyNote,
    getActiveSingleFileDailyNoteDate,
    getSingleFileDailyNotePath,
    getSingleFileDailyNoteEntries,
    isSingleFileDailyNoteDate,
    openSingleFileDailyNote,
    parseSingleFileDailyNoteHeadings,
    sortSingleFileDailyNotes,
    subscribeSingleFileDailyNoteOpened
} from '../../src/utils/singleFileDailyNotes';
import type { MomentApi } from '../../src/utils/moment';
import { createTestTFile } from './createTestTFile';

const confirms = vi.hoisted(() => ({ callbacks: [] as (() => void)[] }));
vi.mock('../../src/modals/ConfirmModal', () => ({
    ConfirmModal: class {
        constructor(_app: unknown, _title: string, _message: string, callback: () => void) {
            confirms.callbacks.push(callback);
        }
        open() {}
    }
}));
vi.mock('../../src/utils/noticeUtils', () => ({ showNotice: vi.fn() }));

const moment = (await vi.importActual<{ default: unknown }>('moment')).default as MomentApi;
const settings = { calendarSingleFilePath: 'Journal/日记.md', calendarConfirmBeforeCreate: false };

function createVault(initial?: string) {
    const app = new App();
    const contents = new Map<string, string>();
    const objects = new Map<string, TFile | TFolder>();
    if (initial !== undefined) {
        objects.set(settings.calendarSingleFilePath, createTestTFile(settings.calendarSingleFilePath));
        contents.set(settings.calendarSingleFilePath, initial);
    }
    const create = vi.fn(async (path: string, content: string) => {
        if (objects.has(path)) throw new Error('File already exists');
        const file = createTestTFile(path);
        objects.set(path, file);
        contents.set(path, content);
        return file;
    });
    const process = vi.fn(async (file: TFile, transform: (content: string) => string) => {
        const result = transform(contents.get(file.path) ?? '');
        contents.set(file.path, result);
        return result;
    });
    Object.assign(app.vault, {
        getAbstractFileByPath: (path: string) => objects.get(path) ?? null,
        cachedRead: async (file: TFile) => contents.get(file.path) ?? '',
        create,
        createFolder: vi.fn(async (path: string) => {
            const folder = new TFolder(path);
            objects.set(path, folder);
            return folder;
        }),
        process
    });
    let cursorLine = 0;
    const setCursor = vi.fn((cursor: { line: number }) => {
        cursorLine = cursor.line;
    });
    const view = Object.assign(new MarkdownView(), {
        file: null as TFile | null,
        getMode: () => 'source',
        editor: {
            getCursor: () => ({ line: cursorLine, ch: 0 }),
            getValue: () => contents.get(settings.calendarSingleFilePath) ?? '',
            setCursor,
            scrollIntoView: vi.fn()
        }
    });
    const openFile = vi.fn(async (file: TFile) => {
        view.file = file;
    });
    const getLeaf = vi.fn(() => ({ openFile, view }));
    Object.defineProperty(app, 'workspace', {
        value: {
            getLeaf,
            getLeavesOfType: vi.fn(() => []),
            getLeftLeaf: vi.fn(() => null),
            revealLeaf: vi.fn(),
            setActiveLeaf: vi.fn(),
            getActiveViewOfType: () => view,
            getActiveFile: () => view.file
        }
    });
    return { app, contents, objects, create, process, openFile, getLeaf, view, setCursor };
}

beforeEach(() => {
    confirms.callbacks.length = 0;
});
afterEach(() => {
    resetMomentApiCacheForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('single-file journal Markdown', () => {
    it('recognizes H1 dates while ignoring YAML, code blocks, nested headings and impossible dates', () => {
        const content = [
            '---',
            'example: |',
            '  # 2026-10-01',
            '---',
            '# 2026-10-10',
            '',
            '```markdown',
            '# 2026-10-11',
            '```',
            '~~~',
            '# 2026-10-12',
            '~~~',
            '## 2026-10-13',
            '> # 2026-10-14',
            '    # 2026-10-15',
            '# 2026-02-30',
            '# 2026-10-09 ###'
        ].join('\n');
        expect([...parseSingleFileDailyNoteHeadings(content)]).toEqual([
            ['2026-10-10', 4],
            ['2026-10-09', 16]
        ]);
    });

    it.each(['2026-02-29', '2026-13-01', '0000-01-01', '2026-1-01'])('rejects invalid date %s', iso => {
        expect(isSingleFileDailyNoteDate(iso)).toBe(false);
    });

    it('accepts leap days and preserves existing content byte-for-byte', () => {
        expect(isSingleFileDailyNoteDate('2024-02-29')).toBe(true);
        const content = '\uFEFF---\r\ntags: [日记]\r\n---\r\n# 2026-10-09\r\n\r\n原文 [[链接]]\r\n';
        const result = appendSingleFileDailyNote(content, '2026-10-10');
        expect(result.content).toBe(`${content}\r\n# 2026-10-10\r\n\r\n`);
        expect(result.content.split('\r\n')[result.line]).toBe('# 2026-10-10');
    });

    it('returns the first existing heading without changing duplicate legacy sections', () => {
        const content = '# 2026-10-10\nFirst\n\n# 2026-10-10\nSecond\n';
        expect(appendSingleFileDailyNote(content, '2026-10-10')).toEqual({ content, line: 0 });
    });

    it.each(['---\ntitle: Journal', '```md\n# 2026-10-09', '~~~~\n```\n# 2026-10-09'])(
        'refuses to append into unfinished Markdown %s',
        content => {
            expect(() => appendSingleFileDailyNote(content, '2026-10-10')).toThrow();
        }
    );

    it('does not close a long fence with a shorter fence', () => {
        const content = '````md\n```\n# 2026-10-09\n````\n';
        expect(parseSingleFileDailyNoteHeadings(content).size).toBe(0);
        expect(appendSingleFileDailyNote(content, '2026-10-10').line).toBe(5);
    });

    it('ignores dates in HTML comments and refuses to append inside an unclosed comment', () => {
        expect([...parseSingleFileDailyNoteHeadings('<!--\n# 2026-10-09\n-->\n# 2026-10-10')]).toEqual([['2026-10-10', 3]]);
        expect(() => appendSingleFileDailyNote('<!--\nExample', '2026-10-10')).toThrow();
    });

    it('inserts a backdated entry before later dates and returns the corrected editor line', () => {
        const result = appendSingleFileDailyNote('# 2026-10-11\nEleventh\n\n', '2026-10-10');
        expect(result).toEqual({ content: '# 2026-10-10\n\n# 2026-10-11\nEleventh\n\n', line: 0 });
    });

    it('repairs an already reversed document when opening an existing date', () => {
        const result = appendSingleFileDailyNote('# 2026-10-11\nEleventh\n\n# 2026-10-10\nTenth\n', '2026-10-11');
        expect(result.content).toBe('# 2026-10-10\nTenth\n# 2026-10-11\nEleventh\n\n');
        expect(result.content.split('\n')[result.line]).toBe('# 2026-10-11');
    });

    it('preserves the BOM, YAML, complete section bodies, fenced examples and CRLF while sorting', () => {
        const prefix = '\uFEFF---\r\ntags: [日记]\r\n---\r\n# 我的日记\r\n简介\r\n\r\n';
        const later = '# 2027-01-01\r\n[[链接]] ![[图片.png]]\r\n```md\r\n# 2025-01-01\r\n```\r\n\r\n';
        const earlier = '# 2026-12-31\r\n## 工作\r\n最后一天\r\n\r\n';
        expect(sortSingleFileDailyNotes(prefix + later + earlier)).toBe(prefix + earlier + later);
    });

    it('retains duplicate date sections in their original relative order and handles a missing final newline', () => {
        const input = '# 2026-10-11\nLater\n\n# 2026-10-10\nFirst\n\n# 2026-10-10\nSecond';
        const output = sortSingleFileDailyNotes(input);
        expect(getSingleFileDailyNoteEntries(output).map(entry => [entry.iso, entry.content.trim()])).toEqual([
            ['2026-10-10', 'First'],
            ['2026-10-10', 'Second'],
            ['2026-10-11', 'Later']
        ]);
        expect(sortSingleFileDailyNotes(output)).toBe(output);
    });

    it('extracts separate preview bodies without leaking the next date or journal preamble', () => {
        const entries = getSingleFileDailyNoteEntries('Journal intro\n# 2026-10-10\nToday [[link]]\n\n# 2026-10-11\nTomorrow\n');
        expect(entries).toEqual([
            { iso: '2026-10-10', line: 1, content: 'Today [[link]]\n\n' },
            { iso: '2026-10-11', line: 4, content: 'Tomorrow\n' }
        ]);
    });
});

describe('single-file journal storage and navigation', () => {
    it('creates only the selected journal, including its parent folder', async () => {
        const vault = createVault();
        const result = await ensureSingleFileDailyNote(vault.app, moment('2026-10-10'), settings);
        expect(result.file.path).toBe('Journal/日记.md');
        expect(result.line).toBe(0);
        expect([...vault.contents.keys()]).toEqual(['Journal/日记.md']);
        expect(vault.contents.get('Journal/日记.md')).toBe('# 2026-10-10\n\n');
    });

    it('records in an existing selected Markdown file without changing the previous journal', async () => {
        const previousContent = '# 2026-10-09\nPrevious journal\n';
        const vault = createVault(previousContent);
        const selectedPath = '记录/工作记录.md';
        vault.objects.set(selectedPath, createTestTFile(selectedPath));
        vault.contents.set(selectedPath, '# 工作记录\n\nExisting introduction\n\n# 2026-10-11\nExisting entry\n');

        const result = await ensureSingleFileDailyNote(vault.app, moment('2026-10-10'), {
            ...settings,
            calendarSingleFilePath: selectedPath
        });

        expect(result.file.path).toBe(selectedPath);
        const selectedContent = vault.contents.get(selectedPath) ?? '';
        expect(selectedContent.startsWith('# 工作记录\n\nExisting introduction\n\n')).toBe(true);
        expect(getSingleFileDailyNoteEntries(selectedContent).map(entry => [entry.iso, entry.content.trim()])).toEqual([
            ['2026-10-10', ''],
            ['2026-10-11', 'Existing entry']
        ]);
        expect(vault.contents.get(settings.calendarSingleFilePath)).toBe(previousContent);
        expect(vault.contents.size).toBe(2);
        expect(vault.create).not.toHaveBeenCalled();
    });

    it('serializes rapid clicks so no file or date is duplicated and no entry is lost', async () => {
        const vault = createVault();
        const dates = ['2026-10-10', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-11'];
        await Promise.all(dates.map(iso => ensureSingleFileDailyNote(vault.app, moment(iso), settings)));
        expect(vault.create).toHaveBeenCalledTimes(1);
        const content = vault.contents.get(settings.calendarSingleFilePath) ?? '';
        expect(content.match(/^# /gm)).toHaveLength(3);
        expect([...parseSingleFileDailyNoteHeadings(content).keys()]).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
    });

    it('uses the latest atomic content instead of overwriting a concurrent edit', async () => {
        const vault = createVault('# 2026-10-09\nOriginal\n');
        vault.process.mockImplementationOnce(async (file, transform) => {
            vault.contents.set(file.path, transform('# 2026-10-09\nOriginal\nConcurrent edit\n'));
            return vault.contents.get(file.path) ?? '';
        });
        await ensureSingleFileDailyNote(vault.app, moment('2026-10-10'), settings);
        expect(vault.contents.get(settings.calendarSingleFilePath)).toContain('Concurrent edit\n\n# 2026-10-10');
    });

    it('recovers after a rejected creation without leaving the write queue blocked', async () => {
        const vault = createVault();
        vault.create.mockRejectedValueOnce(new Error('Disk full'));
        await expect(ensureSingleFileDailyNote(vault.app, moment('2026-10-10'), settings)).rejects.toThrow('Disk full');
        await ensureSingleFileDailyNote(vault.app, moment('2026-10-11'), settings);
        expect(vault.contents.get(settings.calendarSingleFilePath)).toBe('# 2026-10-11\n\n');
    });

    it('opens the requested date at the correct editor line, including a new tab', async () => {
        const vault = createVault('# 2026-10-09\nYesterday\n\n# 2026-10-10\nToday\n');
        await openSingleFileDailyNote(vault.app, moment('2026-10-10'), settings, { context: 'tab' });
        expect(vault.getLeaf).toHaveBeenCalledWith('tab');
        expect(vault.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: settings.calendarSingleFilePath }), {
            active: true,
            eState: { line: 3, subpath: '#2026-10-10' }
        });
        expect(vault.setCursor).toHaveBeenCalledWith({ line: 3, ch: 0 });
        expect(getActiveSingleFileDailyNoteDate(vault.app, settings, moment)?.format('YYYY-MM-DD')).toBe('2026-10-10');
    });

    it('reveals the navigator preview pane and returns editor focus before notifying its subscribers', async () => {
        const vault = createVault('# 2026-10-10\nToday\n');
        const navigatorLeaf = {} as import('obsidian').WorkspaceLeaf;
        const getLeaves = vi.spyOn(vault.app.workspace, 'getLeavesOfType').mockReturnValue([navigatorLeaf]);
        const reveal = vi.spyOn(vault.app.workspace, 'revealLeaf');
        const restore = vi.spyOn(vault.app.workspace, 'setActiveLeaf');
        const listener = vi.fn();
        const unsubscribe = subscribeSingleFileDailyNoteOpened(vault.app, listener);
        await openSingleFileDailyNote(vault.app, moment('2026-10-10'), settings);
        expect(getLeaves).toHaveBeenCalledWith('notebook-navigator');
        expect(reveal).toHaveBeenCalledWith(navigatorLeaf);
        expect(restore).toHaveBeenCalledWith(expect.objectContaining({ view: vault.view }), { focus: true });
        expect(listener).toHaveBeenCalledWith('2026-10-10');
        unsubscribe();
        await openSingleFileDailyNote(vault.app, moment('2026-10-10'), settings);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not create a file or heading before confirmation, and opens existing dates without asking', async () => {
        const vault = createVault('# 2026-10-09\nOld entry\n');
        const confirmingSettings = { ...settings, calendarConfirmBeforeCreate: true };
        await openSingleFileDailyNote(vault.app, moment('2026-10-10'), confirmingSettings);
        expect(confirms.callbacks).toHaveLength(1);
        expect(vault.contents.get(settings.calendarSingleFilePath)).toBe('# 2026-10-09\nOld entry\n');
        expect(vault.openFile).not.toHaveBeenCalled();
        confirms.callbacks[0]();
        await vi.waitFor(() => expect(vault.openFile).toHaveBeenCalledTimes(1));
        await openSingleFileDailyNote(vault.app, moment('2026-10-10'), confirmingSettings);
        expect(confirms.callbacks).toHaveLength(1);
    });

    it('rechecks profile visibility when a confirmation dialog is accepted', async () => {
        const vault = createVault();
        let visible = true;
        await openSingleFileDailyNote(
            vault.app,
            moment('2026-10-10'),
            { ...settings, calendarConfirmBeforeCreate: true },
            { canOpen: () => visible }
        );
        visible = false;
        confirms.callbacks[0]();
        await Promise.resolve();
        expect(vault.create).not.toHaveBeenCalled();
    });

    it('reports command queue failures instead of silently claiming the entry was opened', async () => {
        const vault = createVault('# 2026-10-10\n');
        const commandQueue = new (await import('../../src/services/CommandQueueService')).CommandQueueService();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(commandQueue, 'executeOpenActiveFile').mockResolvedValue({ success: false, error: new Error('Open failed') });
        const onOpened = vi.fn();
        await openSingleFileDailyNote(vault.app, moment('2026-10-10'), settings, { commandQueue, onOpened });
        expect(onOpened).not.toHaveBeenCalled();
        expect(showNotice).toHaveBeenLastCalledWith('Open failed');
    });

    it.each(['../escape.md', 'C:\\notes\\diary.md', '/absolute.md', '.private/data.md', 'Journal/../escape.md', 'note?.md'])(
        'rejects invalid destination %s',
        path => {
            expect(() => getSingleFileDailyNotePath({ calendarSingleFilePath: path })).toThrow();
        }
    );

    it('defaults to one journal and adds the Markdown extension', () => {
        expect(getSingleFileDailyNotePath({ calendarSingleFilePath: ' ' })).toBe('日记.md');
        expect(getSingleFileDailyNotePath({ calendarSingleFilePath: 'Journal/日记' })).toBe('Journal/日记.md');
    });
});

describe('single-file journal commands', () => {
    function registerJournalCommands(app: App) {
        vi.stubGlobal('window', { moment });
        resetMomentApiCacheForTests();
        const commands = new Map<string, Command>();
        registerNavigatorCommands({
            app,
            settings: { ...DEFAULT_SETTINGS, ...settings, calendarIntegrationMode: 'single-file' },
            commandQueue: null,
            addCommand: (command: Command) => {
                commands.set(command.id, command);
            }
        } as unknown as NotebookNavigatorPlugin);
        return commands;
    }

    it('opens today in the journal and blocks separate weekly, monthly, quarterly and yearly files', async () => {
        const vault = createVault();
        const commands = registerJournalCommands(vault.app);
        commands.get('open-daily-note')?.callback?.();
        await vi.waitFor(() => expect(vault.openFile).toHaveBeenCalledTimes(1));
        expect(vault.contents.get(settings.calendarSingleFilePath)).toBe(`# ${moment().locale('en').format('YYYY-MM-DD')}\n\n`);
        for (const kind of ['weekly', 'monthly', 'quarterly', 'yearly']) commands.get(`open-${kind}-note`)?.callback?.();
        await Promise.resolve();
        expect([...vault.contents.keys()]).toEqual([settings.calendarSingleFilePath]);
        expect(vault.create).toHaveBeenCalledTimes(1);
    });

    it('moves to adjacent dates from the current section while keeping all content in the same document', async () => {
        const vault = createVault('# 2026-10-10\nOriginal\n');
        const commands = registerJournalCommands(vault.app);
        await openSingleFileDailyNote(vault.app, moment('2026-10-10'), settings);
        const next = commands.get('open-next-periodic-note');
        const previous = commands.get('open-previous-periodic-note');
        expect(next?.checkCallback?.(true)).toBe(true);
        next?.checkCallback?.(false);
        await vi.waitFor(() => expect(vault.openFile).toHaveBeenCalledTimes(2));
        expect(getActiveSingleFileDailyNoteDate(vault.app, settings, moment)?.format('YYYY-MM-DD')).toBe('2026-10-11');
        previous?.checkCallback?.(false);
        await vi.waitFor(() => expect(vault.openFile).toHaveBeenCalledTimes(3));
        expect(getActiveSingleFileDailyNoteDate(vault.app, settings, moment)?.format('YYYY-MM-DD')).toBe('2026-10-10');
        expect(commands.get('open-parent-periodic-note')?.checkCallback?.(true)).toBe(false);
        expect(vault.contents.get(settings.calendarSingleFilePath)).toBe('# 2026-10-10\nOriginal\n\n# 2026-10-11\n\n');
        expect(vault.contents.size).toBe(1);
    });
});
