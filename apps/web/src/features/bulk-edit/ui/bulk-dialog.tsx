'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { BulkJob, ProductFilter } from '@catalog/shared';
import { COLUMN_BY_FIELD } from '@/entities/product';
import {
  bulkKeys,
  cancelBulkJob,
  createBulkJob,
  getBulkJob,
  isActiveJob,
  previewBulk,
  revertBulkJob,
} from '@/entities/bulk-job';
import { isApiFailure } from '@/shared/api/error';
import type { AppLocale } from '@/shared/lib/locale';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import {
  NUMBER_FIELDS,
  SET_FIELDS,
  buildOperation,
  type OperationKind,
} from '../lib/build-operation';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filter: ProductFilter;
  locale: AppLocale;
  /** Called when a job (or its revert) has finished, so the table can reload without a page refresh. */
  onFinished: () => void;
};

const KINDS: OperationKind[] = ['percent', 'absolute', 'set', 'addTag', 'removeTag'];

export const BulkDialog = ({ open, onOpenChange, filter, locale, onFinished }: Props) => {
  const t = useTranslations();
  const [jobId, setJobId] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="bulk-desc">
        <DialogTitle>{t('bulk.title')}</DialogTitle>
        <DialogDescription id="bulk-desc">{t('bulk.description')}</DialogDescription>
        {jobId === null ? (
          <BulkForm filter={filter} locale={locale} onStarted={setJobId} />
        ) : (
          <JobPanel jobId={jobId} onFinished={onFinished} onNew={() => setJobId(null)} />
        )}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('bulk.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const BulkForm = ({
  filter,
  locale,
  onStarted,
}: {
  filter: ProductFilter;
  locale: AppLocale;
  onStarted: (id: string) => void;
}) => {
  const t = useTranslations();
  const [kind, setKind] = useState<OperationKind>('percent');
  const [field, setField] = useState<(typeof NUMBER_FIELDS)[number] | (typeof SET_FIELDS)[number]>(
    'price',
  );
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);

  const preview = useQuery({
    queryKey: bulkKeys.preview(filter),
    queryFn: () => previewBulk(filter),
    staleTime: 0,
  });
  const built = buildOperation({ kind, field, text }, locale);
  const fieldChoices = kind === 'set' ? SET_FIELDS : NUMBER_FIELDS;

  const start = useMutation({
    mutationFn: () => {
      if (!built.ok) throw new Error('invalid');
      return createBulkJob({ filter, operation: built.operation });
    },
    onSuccess: (job) => onStarted(job.id),
  });

  const changeKind = (k: OperationKind) => {
    setKind(k);
    setText('');
    setTouched(false);
    if (k === 'set' && !(SET_FIELDS as readonly string[]).includes(field)) setField('price');
    if (
      (k === 'percent' || k === 'absolute') &&
      !(NUMBER_FIELDS as readonly string[]).includes(field)
    )
      setField('price');
  };

  const col = kind === 'set' ? COLUMN_BY_FIELD[field] : null;
  const showError = touched && !built.ok;
  const canStart =
    built.ok &&
    (preview.data?.count ?? 0) > 0 &&
    (preview.data?.editable ?? 0) > 0 &&
    !start.isPending;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (canStart) start.mutate();
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t('bulk.operation')}</span>
        <select
          className="h-9 rounded-md border border-border bg-background px-2"
          value={kind}
          onChange={(e) => changeKind(e.target.value as OperationKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`bulk.kind.${k}`)}
            </option>
          ))}
        </select>
      </label>

      {(kind === 'set' || kind === 'percent' || kind === 'absolute') && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t('bulk.field')}</span>
          <select
            className="h-9 rounded-md border border-border bg-background px-2"
            value={field}
            onChange={(e) => setField(e.target.value as typeof field)}
          >
            {fieldChoices.map((f) => (
              <option key={f} value={f}>
                {t(`columns.${f}`)}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-col gap-1.5 text-sm">
        <label htmlFor="bulk-value" className="font-medium">
          {kind === 'addTag' || kind === 'removeTag'
            ? t('bulk.tag')
            : kind === 'set'
              ? t('bulk.value')
              : t('bulk.amount')}
        </label>
        {col?.kind === 'select' ? (
          <select
            id="bulk-value"
            className="h-9 rounded-md border border-border bg-background px-2"
            value={text}
            onChange={(e) => setText(e.target.value)}
          >
            <option value="">{col.nullable ? t('grid.noCategory') : ''}</option>
            {col.options?.map((o) => (
              <option key={o} value={o}>
                {t(`${field === 'category' ? 'categories' : 'status'}.${o}`)}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id="bulk-value"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setTouched(true);
            }}
            inputMode={
              kind === 'percent' ||
              kind === 'absolute' ||
              col?.kind === 'decimal' ||
              col?.kind === 'integer'
                ? 'decimal'
                : 'text'
            }
            aria-invalid={showError || undefined}
            aria-describedby={
              showError ? 'bulk-value-err' : kind === 'percent' ? 'bulk-value-hint' : undefined
            }
          />
        )}
        {kind === 'percent' && !showError && (
          <p id="bulk-value-hint" className="text-xs text-muted-foreground">
            {t('bulk.percentHint')}
          </p>
        )}
        {showError && !built.ok && (
          <p id="bulk-value-err" role="alert" className="text-xs text-danger">
            {t(`bulk.operationError.${built.error}` as never)}
          </p>
        )}
      </div>

      <p
        role="status"
        aria-live="polite"
        className="rounded border border-border bg-muted p-2 text-sm"
      >
        {preview.isPending
          ? t('bulk.previewLoading')
          : preview.isError
            ? t('bulk.previewError')
            : preview.data.count === 0
              ? t('bulk.previewNone')
              : t('bulk.preview', { count: preview.data.count, editable: preview.data.editable })}
      </p>

      {start.isError && (
        <p role="alert" className="text-sm text-danger">
          {isApiFailure(start.error) && start.error.status === 429
            ? t('bulk.tooMany')
            : t('bulk.startError')}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={start.isPending || (touched && !canStart)}>
          {start.isPending ? t('bulk.starting') : t('bulk.start')}
        </Button>
      </div>
    </form>
  );
};

export const JobPanel = ({
  jobId,
  onFinished,
  onNew,
}: {
  jobId: string;
  onFinished: () => void;
  onNew: () => void;
}) => {
  const t = useTranslations();
  const job = useQuery({
    queryKey: bulkKeys.job(jobId),
    queryFn: () => getBulkJob(jobId),
    refetchInterval: (q) => (q.state.data && !isActiveJob(q.state.data) ? false : 400),
    staleTime: 0,
  });
  const cancel = useMutation({
    mutationFn: () => cancelBulkJob(jobId),
    onSuccess: () => job.refetch(),
  });
  const revert = useMutation({
    mutationFn: () => revertBulkJob(jobId),
    onSuccess: () => job.refetch(),
  });

  // Tell the page once per finished phase (apply, then revert) so the table reloads without a page refresh.
  const reported = useRef<string | null>(null);
  const status = job.data?.status;
  useEffect(() => {
    if (!status || ['queued', 'running', 'cancelling', 'reverting'].includes(status)) return;
    if (reported.current !== status) {
      reported.current = status;
      onFinished();
    }
  }, [status, onFinished]);

  if (job.isError)
    return (
      <p role="alert" className="text-sm text-danger">
        {t('bulk.error')}
      </p>
    );
  const j = job.data;
  if (!j) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  const active = isActiveJob(j);
  const pct = j.total === 0 ? 100 : Math.round((j.processed / j.total) * 100);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold" data-testid="job-status">
          {t(`bulk.status.${j.status}`)}
        </span>
        <span aria-hidden>{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={t('bulk.title')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={j.status === 'reverting' || j.status === 'reverted' ? 100 : pct}
        aria-valuetext={t('bulk.progress', { processed: j.processed, total: j.total })}
        className="h-2 overflow-hidden rounded bg-muted"
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm" role="status" aria-live="polite">
        {t('bulk.progress', { processed: j.processed, total: j.total })}.{' '}
        {t('bulk.applied', { count: j.applied })}
        {j.skipped > 0 ? `. ${t('bulk.skipped', { count: j.skipped })}` : ''}
        {j.status === 'reverted' || j.status === 'reverting'
          ? `. ${t('bulk.revertDone', { count: j.revertedCount })}`
          : ''}
        {j.revertReport.length > 0
          ? `. ${t('bulk.revertSkipped', { count: j.revertReport.length })}`
          : ''}
        .
      </p>

      <div className="flex gap-2">
        {(j.status === 'queued' || j.status === 'running') && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending}
          >
            {t('bulk.cancel')}
          </Button>
        )}
        {!active && j.applied > 0 && j.status !== 'reverted' && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => revert.mutate()}
            disabled={revert.isPending}
          >
            {t('bulk.revert')}
          </Button>
        )}
        {!active && (
          <Button variant="ghost" size="sm" onClick={onNew}>
            {t('bulk.another')}
          </Button>
        )}
      </div>
      {revert.isError && (
        <p role="alert" className="text-sm text-danger">
          {t('bulk.error')}
        </p>
      )}

      <Report title={t('bulk.report')} items={j.report} total={j.skipped} />
      <Report title={t('bulk.revertReport')} items={j.revertReport} total={j.revertReport.length} />
    </div>
  );
};

const Report = ({
  title,
  items,
  total,
}: {
  title: string;
  items: BulkJob['report'];
  total: number;
}) => {
  const t = useTranslations();
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="max-h-56 overflow-auto rounded border border-border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th scope="col" className="px-2 py-1">
                {t('bulk.sku')}
              </th>
              <th scope="col" className="px-2 py-1">
                {t('bulk.reason')}
              </th>
              <th scope="col" className="px-2 py-1">
                {t('bulk.details')}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.productId} className="border-t border-border">
                <td className="px-2 py-1 font-mono">{i.sku}</td>
                <td className="px-2 py-1">{t(`bulk.reasons.${i.reason}`)}</td>
                <td className="px-2 py-1">{i.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > items.length && (
        <p className="text-xs text-muted-foreground">
          {t('bulk.reportTruncated', { shown: items.length, total })}
        </p>
      )}
    </section>
  );
};
