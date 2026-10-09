
/** Describes supplied provenance, never verification or approval. */
export function SourceTag({ source, title }: { source: 'fact' | 'ai'; title?: string }) {
  return <span className={`ui-foundation ui-source ui-source--${source}`} title={title}>{source === 'fact' ? '程序事实' : 'AI 推断'}</span>;
}
