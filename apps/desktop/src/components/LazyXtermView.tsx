import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const Terminal = lazy(() => import('./XtermView').then(({ XtermView }) => ({ default: XtermView })));

export function LazyXtermView(props: ComponentProps<typeof Terminal>) {
  return <Suspense fallback={<p role="status">正在加载终端…</p>}><Terminal {...props} /></Suspense>;
}
