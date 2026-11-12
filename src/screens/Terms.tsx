import { PageContainer } from '../components/ds';

// Terms of use and privacy summary. Plain-language draft: have it reviewed before launch
// (see docs/BUILD_REPORT.md).

const SECTIONS: Array<[string, string[]]> = [
  ['Using Forka', [
    'Forka helps you plan meals, make a grocery list and cook. You need an account to use it, and you\'re responsible for keeping your password private.',
    'You must be at least 13 years old to create an account.',
  ]],
  ['Allergies and food safety', [
    'Forka hides recipes that contain the allergens you choose in Settings, based on the ingredient lists we have. Ingredient lists can be incomplete and products vary, so always check labels and recipes yourself before cooking for someone with an allergy.',
    'Cooking times and temperatures are a guide. Make sure food, especially meat, eggs and fish, is cooked through.',
  ]],
  ['Recipes and photos', [
    'Recipes and photos come from TheMealDB (themealdb.com). We convert measurements and ingredient names for US kitchens, so check the original recipe if something looks off.',
    'Suggestions and photo matches are chosen automatically from that catalog. They can be imperfect.',
  ]],
  ['Your data', [
    'We store your account details, settings (including allergies and diet), week plans, grocery lists, favorites, collections, notes, ratings and the meals you mark as cooked, so the app works across your devices.',
    'Photos you use to find similar meals are sent for analysis and not stored. We keep the dish name we found so future suggestions can use it.',
    'You can delete your account and everything stored with it at any time in Settings.',
  ]],
  ['Changes', [
    'We may update these terms. If the changes are significant, we\'ll tell you in the app before they apply.',
  ]],
];

export function Terms({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-dvh bg-cream">
      <PageContainer title="Terms of use" onBack={onBack} intro="Last updated October 15, 2026">
        <div className="space-y-8">
          {SECTIONS.map(([heading, paragraphs]) => (
            <section key={heading}>
              <h2 className="mb-2 text-heading text-ink">{heading}</h2>
              {paragraphs.map(p => <p key={p.slice(0, 24)} className="mb-3 text-body text-ink">{p}</p>)}
            </section>
          ))}
        </div>
      </PageContainer>
    </div>
  );
}
