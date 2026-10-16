const { z } = require("zod");

const text = (max) => z.string().trim().min(1, "Required").max(max);
const imageKey = z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,59}$/, "Invalid image key");
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Invalid category slug").max(60);
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid venue id");

const intro = z
  .object({ eyebrow: text(60), title: text(80), accent: text(80), description: text(400).optional() })
  .strict();

const landingContentSchema = z
  .object({
    hero: z.object({ tagline: text(200), eyebrow: text(120) }).strict(),
    venueTypesIntro: intro,
    venueTypes: z
      .array(z.object({ slug, name: text(60), imageKey, badgeKey: imageKey }).strict())
      .min(1)
      .max(8),
    storiesIntro: intro,
    stories: z
      .array(
        z
          .object({
            eyebrow: text(40),
            title: text(80),
            description: text(320),
            imageKey,
            imageSizes: z.string().max(200).optional(),
            category: slug.nullish(),
            venueId: objectId.nullish(),
          })
          .strict()
      )
      .min(1)
      .max(3),
    seasonsIntro: intro,
    seasons: z
      .array(z.object({ name: text(30), title: text(40), description: text(320), imageKey }).strict())
      .min(1)
      .max(4),
    featuredIntro: intro,
    testimonialsIntro: intro,
    partnerCta: intro,
  })
  .strict();

module.exports = { landingContentSchema };
