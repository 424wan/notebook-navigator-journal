import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JournalEntryCards } from '../../src/components/SingleFileJournalPane';
import { getSingleFileDailyNoteEntries } from '../../src/utils/singleFileDailyNotes';
import { PreviewTextUtils } from '../../src/utils/previewTextUtils';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';

describe('single-file journal preview cards', () => {
    it('renders an independent summary for each date in the same Markdown document', () => {
        const entries = getSingleFileDailyNoteEntries('# 2026-10-10\n你好 **今天** [[项目|工作]]\n\n# 2026-10-11\n明天去散步\n');
        const cards = entries.map(entry => ({ ...entry, preview: PreviewTextUtils.extractPreviewText(entry.content, DEFAULT_SETTINGS) }));
        expect(cards[0].preview).toContain('你好');
        expect(cards[0].preview).not.toContain('明天去散步');
        expect(cards[1].preview).toBe('明天去散步');
        const html = renderToStaticMarkup(
            React.createElement(JournalEntryCards, { entries: cards, activeIso: '2026-10-11', onOpen: () => {} })
        );
        expect(html).toContain('2026-10-10');
        expect(html).toContain('2026-10-11');
        expect(html).toContain('你好');
        expect(html).toContain('明天去散步');
        expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    });

    it('shows an empty-day placeholder and renders text safely rather than interpreting embedded HTML', () => {
        const html = renderToStaticMarkup(
            React.createElement(JournalEntryCards, {
                entries: [
                    { iso: '2026-10-10', line: 0, preview: '' },
                    { iso: '2026-10-11', line: 2, preview: '<script>unsafe</script>' }
                ],
                activeIso: null,
                onOpen: () => {}
            })
        );
        expect(html).toContain('No content yet');
        expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
        expect(html).not.toContain('<script>');
    });
});
