/*
 * Local modification, 2026-10-11: choose an existing Markdown journal file.
 * Distributed under the GNU General Public License, version 3 or later.
 */

import { App, TFile } from 'obsidian';
import { strings } from '../i18n';
import type { MaybePromise } from '../utils/async';
import { naturalCompare } from '../utils/sortUtils';
import { BaseSuggestModal } from './BaseSuggestModal';

/** Selects a journal destination without changing the contents of any note. */
export class SingleFileJournalModal extends BaseSuggestModal<TFile> {
    constructor(app: App, onChoose: (file: TFile) => MaybePromise) {
        super(app, onChoose, strings.settings.items.singleFileDailyNotes.fileSearchPlaceholder, {
            navigate: strings.modals.folderSuggest.instructions.navigate,
            action: strings.modals.folderSuggest.instructions.select,
            dismiss: strings.modals.folderSuggest.instructions.dismiss
        });
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles().sort((a, b) => naturalCompare(a.path, b.path));
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    protected getDisplayPath(file: TFile): string {
        return file.path;
    }
}
