import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { MouseEvent } from 'react';

marked.use({ gfm: true, breaks: true });

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'iframe', 'form', 'input'],
  });
}

export function openLinksExternally(event: MouseEvent<HTMLDivElement>): void {
  const anchor = (event.target as HTMLElement).closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href) return;
  event.preventDefault();
  if (/^https:\/\//.test(href)) void window.moyu?.openExternal(href);
}

export function highlightCode(root: HTMLElement): void {
  root.querySelectorAll('pre code').forEach((block) => {
    const element = block as HTMLElement;
    if (element.dataset.enhanced) return;
    element.dataset.enhanced = '1';
    const button = document.createElement('button');
    button.className = 'code-copy';
    button.type = 'button';
    button.textContent = '复制';
    button.addEventListener('click', () => {
      void navigator.clipboard.writeText(element.textContent ?? '');
      button.textContent = '已复制';
      setTimeout(() => (button.textContent = '复制'), 1400);
    });
    element.parentElement?.appendChild(button);
  });
}