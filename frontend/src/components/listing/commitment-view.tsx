import { useTranslations } from 'next-intl'
import type { ProductCommitment } from '@/lib/commitment'

export function CommitmentView({ commitment, compact = false }: {
  commitment: ProductCommitment | null | undefined
  compact?: boolean
}) {
  const t = useTranslations('commitmentFields')
  if (!commitment) return <p className="text-sm text-muted-foreground">
    {t('newCommitmentNotRecordedNewOrdersAreUnavailableUntilTheSellerComp')}
  </p>
  const row = (name: string, value: string | number | boolean | null | undefined) =>
    <div className="border-t pt-2" key={name}>
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="whitespace-pre-wrap break-words font-medium">{String(value ?? t('notRecorded'))}</dd>
    </div>
  const windowText = (value: { min: number; max: number; unit: string }) =>
    `${value.min}–${value.max} ${value.unit === 'days' ? t('days2') : t('hours')}`
  const durationText = (value: number | undefined, unit: string | undefined) =>
    `${value ?? '—'} ${unit === 'months' ? t('months') : t('days')}`
  if ('resourceMode' in commitment) return <section className="space-y-2 text-sm">
    <p className="font-semibold">{t('sellerSuppliedDigitalResourceCommitment')}</p>
    <dl className="grid gap-3 sm:grid-cols-2">
      {row(t('deliveryMode'), commitment.resourceMode === 'file'
        ? t('fileDelivery') : t('onlineAccess'))}
      {row(t('deliverables'), commitment.deliverables.map((item) =>
        `${item.name} · ${item.format} × ${item.quantity}`).join('\n'))}
      {row(t('sellerEstimatedDelivery'),
        windowText(commitment.estimatedDeliveryWindow))}
      {row(t('useScope'), commitment.sellerUseNotes)}
      {commitment.resourceMode === 'access' && row(t('accessDurationFromAcceptance'),
        durationText(commitment.accessDurationValue, commitment.accessDurationUnit))}
      {commitment.resourceMode === 'file' && row(t('useTerm'), commitment.useTerm)}
      {commitment.resourceMode === 'access' && row(t('afterExpiry'), commitment.expiryBehavior)}
      {row(t('restrictions'), commitment.noOtherRestrictions
        ? t('sellerDeclaresNoOtherRestrictions')
        : commitment.exclusions.join('\n'))}
      {!compact && <>
        <div className="border-t pt-2">
          <dt className="text-muted-foreground">{t('sourceUrlSellerSupplied')}</dt>
          <dd>{commitment.sourceTermsUrl ?
            <a href={commitment.sourceTermsUrl} target="_blank" rel="noopener noreferrer"
              className="break-all text-primary underline">{commitment.sourceTermsUrl}</a>
            : t('notSupplied')}</dd>
        </div>
        {commitment.resourceMode === 'file' ? <>
          {row(t('seatTeamOrProjectScope'), commitment.seatOrProjectScope)}
          {row(t('updatesIncluded2'), commitment.updatesIncluded
            ? t('yes') : t('no'))}
          {row(t('sourceFilesIncluded2'), commitment.sourceFilesIncluded
            ? t('yes') : t('no'))}
          {row(t('fileFormats'), commitment.fileFormats?.join('、'))}
          {row(t('thirdPartyComponents'), commitment.thirdPartyComponents)}
        </> : <>
          {row(t('accessTermNotes2'), commitment.accessTermNotes)}
        </>}
      </>}
    </dl>
    {!compact && <p className="text-xs text-muted-foreground">
      {t('sellerSuppliedThePlatformDoesNotVerifySourcePagesCalculateExpiryD')}
    </p>}
  </section>
  return <section className="space-y-2 text-sm">
    <p className="font-semibold">{t('sellerSuppliedPhysicalItemCommitment')}</p>
    <dl className="grid gap-3 sm:grid-cols-2">
      {row(t('condition'), ({ like_new: t('likeNew'),
        good: t('good'), fair: t('fair'), worn: t('worn')
      })[commitment.conditionGrade])}
      {row(t('knownDefects'), commitment.knownDefects)}
      {row(t('includedItems'), commitment.includedItems.join('、'))}
      {row(t('functionalStatus'), ({ normal: t('normal'),
        partially_faulty: t('partiallyFaulty'), not_working: t('notWorking'),
        untested: t('untested'), not_applicable: t('notApplicable')
      })[commitment.functionalStatus])}
      {!compact && row(t('functionalNotes'), commitment.functionalNotes)}
      {row(t('sellerEstimatedDispatch'),
        windowText(commitment.estimatedDispatchWindow))}
    </dl>
    {!compact && <p className="text-xs text-muted-foreground">
      {t('sellerArrangesCourierThePlatformRecordsTheCarrierReferenceAndSubm')}
    </p>}
  </section>
}
