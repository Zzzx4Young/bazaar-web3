'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { DigitalCommitment, PhysicalCommitment, ProductCommitment } from '@/lib/commitment'

function split(value: string) { return value.split(/[,，\n]/).map((part) => part.trim()).filter(Boolean) }
const field = 'w-full rounded-md border bg-background px-3 py-2 text-sm'

export function CommitmentEditor({ type, value, onChange }: {
  type: 'digital' | 'physical'
  value: ProductCommitment
  onChange: (value: ProductCommitment) => void
}) {
  const t = useTranslations('commitmentFields')
  if (type === 'physical') {
    const item = value as PhysicalCommitment
    const set = (patch: Partial<PhysicalCommitment>) => onChange({ ...item, ...patch })
    return <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">{t('sellerPhysicalCommitment')}</h3>
      <label className="block text-sm">{t('condition')}
        <select className={field} value={item.conditionGrade}
          onChange={(e) => set({ conditionGrade: e.target.value as PhysicalCommitment['conditionGrade'] })}>
          <option value="like_new">{t('likeNew')}</option>
          <option value="good">{t('good')}</option>
          <option value="fair">{t('fair')}</option>
          <option value="worn">{t('worn')}</option>
        </select>
      </label>
      <label className="block text-sm">{t('knownDefectsStateNoneExplicitly')}
        <Textarea value={item.knownDefects} onChange={(e) => set({ knownDefects: e.target.value })} />
      </label>
      <label className="block text-sm">{t('includedItemsCommaSeparated')}
        <Input value={item.includedItems.join('，')}
          onChange={(e) => set({ includedItems: split(e.target.value) })} />
      </label>
      <label className="block text-sm">{t('functionalStatus')}
        <select className={field} value={item.functionalStatus}
          onChange={(e) => set({ functionalStatus: e.target.value as PhysicalCommitment['functionalStatus'] })}>
          <option value="normal">{t('normal')}</option>
          <option value="partially_faulty">{t('partiallyFaulty')}</option>
          <option value="not_working">{t('notWorking')}</option>
          <option value="untested">{t('untested')}</option>
          <option value="not_applicable">{t('notApplicable')}</option>
        </select>
      </label>
      <label className="block text-sm">{t('functionalNotesStateNoKnownIssueExplicitly')}
        <Textarea value={item.functionalNotes} onChange={(e) => set({ functionalNotes: e.target.value })} />
      </label>
      <WindowEditor value={item.estimatedDispatchWindow}
        onChange={(estimatedDispatchWindow) => set({ estimatedDispatchWindow })}
        label={t('estimatedDispatchAfterSimulatedPayment')} />
      <p className="text-xs text-muted-foreground">{t('sellerArrangesCourierNoPlatformShippingOrLiveTracking')}</p>
    </div>
  }
  const item = value as DigitalCommitment
  const set = (patch: Partial<DigitalCommitment>) => onChange({ ...item, ...patch })
  return <div className="space-y-3 rounded-lg border p-4">
    <h3 className="font-semibold">{t('sellerDigitalResourceCommitment')}</h3>
    <label className="block text-sm">{t('resourceDeliveryMode')}
      <select className={field} value={item.resourceMode}
        onChange={(e) => set({ resourceMode: e.target.value as DigitalCommitment['resourceMode'],
          accessDurationValue: item.accessDurationValue ?? 30,
          accessDurationUnit: item.accessDurationUnit ?? 'days',
          accessTermNotes: item.accessTermNotes ?? '', expiryBehavior: item.expiryBehavior ?? '' })}>
        <option value="file">{t('fileDelivery')}</option>
        <option value="access">{t('onlineAccess')}</option>
      </select>
    </label>
    {item.deliverables.map((deliverable, index) => <div key={index} className="space-y-2 rounded border p-2">
      <label className="block text-sm">{t('deliverableName')}
        <Input value={deliverable.name} onChange={(event) => set({ deliverables:
          item.deliverables.map((part, at) => at === index ? { ...part, name: event.target.value } : part)
        })} />
      </label>
      <label className="block text-sm">{t('formatOrVersion')}
        <Input value={deliverable.format} onChange={(event) => set({ deliverables:
          item.deliverables.map((part, at) => at === index ? { ...part, format: event.target.value } : part)
        })} />
      </label>
      <label className="block text-sm">{t('quantity')}
        <Input type="number" min={1} max={999} value={deliverable.quantity}
          onChange={(event) => set({ deliverables: item.deliverables.map((part, at) =>
            at === index ? { ...part, quantity: Number(event.target.value) } : part) })} />
      </label>
      {item.deliverables.length > 1 && <button type="button" className="text-sm underline"
        onClick={() => set({ deliverables: item.deliverables.filter((_, at) => at !== index) })}>
        {t('remove')}
      </button>}
    </div>)}
    {item.deliverables.length < 12 && <button type="button" className="text-sm underline"
      onClick={() => set({ deliverables: [...item.deliverables,
        { name: '', format: '', quantity: 1 }] })}>
      {t('addDeliverable')}
    </button>}
    <label className="block text-sm">{t('sellerUseScope')}
      <Textarea value={item.sellerUseNotes} onChange={(e) => set({ sellerUseNotes: e.target.value })} />
    </label>
    <label className="block text-sm">{t('restrictionsOnePerLine')}
      <Textarea disabled={item.noOtherRestrictions} value={item.exclusions.join('\n')}
        onChange={(e) => set({ exclusions: split(e.target.value) })} />
    </label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={item.noOtherRestrictions}
      onChange={(e) => set({ noOtherRestrictions: e.target.checked, exclusions: [] })} />
      {t('sellerDeclaresNoOtherRestrictions')}
    </label>
    <label className="block text-sm">{t('publicSourceUrlOptionalHttps')}
      <Input type="url" value={item.sourceTermsUrl ?? ''}
        onChange={(e) => set({ sourceTermsUrl: e.target.value || null })} />
    </label>
    <WindowEditor value={item.estimatedDeliveryWindow}
      onChange={(estimatedDeliveryWindow) => set({ estimatedDeliveryWindow })}
      label={t('estimatedDeliveryAfterSimulatedPayment')} />
    {item.resourceMode === 'file' ? <>
      <label className="block text-sm">{t('useTerm')}
        <Input value={item.useTerm ?? ''} onChange={(e) => set({ useTerm: e.target.value })} />
      </label>
      <label className="block text-sm">{t('seatTeamOrProjectScope')}
        <Input value={item.seatOrProjectScope ?? ''} onChange={(e) => set({ seatOrProjectScope: e.target.value })} />
      </label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={item.updatesIncluded ?? false}
        onChange={(e) => set({ updatesIncluded: e.target.checked })} />
        {t('updatesIncluded')}
      </label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={item.sourceFilesIncluded ?? false}
        onChange={(e) => set({ sourceFilesIncluded: e.target.checked })} />
        {t('sourceFilesIncluded')}
      </label>
      <label className="block text-sm">{t('fileFormatsCommaSeparated')}
        <Input value={item.fileFormats?.join('，') ?? ''}
          onChange={(e) => set({ fileFormats: split(e.target.value) })} />
      </label>
      <label className="block text-sm">{t('thirdPartyComponentsAndRestrictions')}
        <Textarea value={item.thirdPartyComponents ?? ''}
          onChange={(e) => set({ thirdPartyComponents: e.target.value })} />
      </label>
    </> : <>
      <label className="block text-sm">{t('accessDuration')}
        <Input type="number" min={1} max={1200} value={item.accessDurationValue ?? 30}
          onChange={(e) => set({ accessDurationValue: Number(e.target.value) })} />
      </label>
      <label className="block text-sm">{t('durationUnit')}
        <select className={field} value={item.accessDurationUnit ?? 'days'}
          onChange={(e) => set({ accessDurationUnit: e.target.value as 'days' | 'months' })}>
          <option value="days">{t('days')}</option><option value="months">{t('months')}</option>
        </select>
      </label>
      <label className="block text-sm">{t('accessTermNotes')}
        <Textarea value={item.accessTermNotes ?? ''}
          onChange={(e) => set({ accessTermNotes: e.target.value })} />
      </label>
      <label className="block text-sm">{t('expiryDownloadsAndRenewal')}
        <Textarea value={item.expiryBehavior ?? ''}
          onChange={(e) => set({ expiryBehavior: e.target.value })} />
      </label>
    </>}
    <p className="text-xs text-muted-foreground">{t('sellerStatementsOnlyThePlatformDoesNotVerifySourcesControlExterna')}</p>
  </div>
}

function WindowEditor({ value, onChange, label }: {
  value: { min: number; max: number; unit: 'hours' | 'days' }
  onChange: (value: { min: number; max: number; unit: 'hours' | 'days' }) => void
  label: string
}) {
  const t = useTranslations('commitmentFields')
  return <fieldset className="space-y-1"><legend className="text-sm">{label}</legend>
    <div className="flex gap-2">
      <Input aria-label={`${label} min`} type="number" min={1} max={365} value={value.min}
        onChange={(e) => onChange({ ...value, min: Number(e.target.value) })} />
      <Input aria-label={`${label} max`} type="number" min={1} max={365} value={value.max}
        onChange={(e) => onChange({ ...value, max: Number(e.target.value) })} />
      <select aria-label={`${label} unit`} className={field} value={value.unit}
        onChange={(e) => onChange({ ...value, unit: e.target.value as 'hours' | 'days' })}>
        <option value="hours">h</option><option value="days">d</option>
      </select>
    </div>
  </fieldset>
}
