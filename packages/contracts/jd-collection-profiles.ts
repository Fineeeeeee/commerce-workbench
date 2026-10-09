export const jdCollectionProfiles = {
  shampoo: { label: '洗发水', categoryCode: 'shampoo', leafCategoryIds: [16756, 16761], titleTerms: ['洗发水', '洗发露', '洗护'] },
  facial_cleanser: { label: '洗面奶', categoryCode: 'facial-cleanser', leafCategoryIds: [1389, 16840], titleTerms: ['洁面', '洗面奶', '洗面乳', '洗面啫喱'] },
} as const;

export type JdCollectionProfile = keyof typeof jdCollectionProfiles;

export function matchesJdProfile(profile: JdCollectionProfile, leafId: number | undefined, title: string) {
  const config = jdCollectionProfiles[profile];
  return leafId !== undefined && (config.leafCategoryIds as readonly number[]).includes(leafId)
    && config.titleTerms.some(term => title.includes(term));
}
