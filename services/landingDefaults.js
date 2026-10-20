// The seeded home page copy. `imageKey`/`badgeKey` are names the frontend maps to its own bundled images.
// `category` links a story to /venues?spaceType=... (it holds a SPACE type slug; the field name is kept so saved content still works);
// `venueId` (optional) links it to one real venue.
const LANDING_DEFAULTS = {
  hero: {
    tagline: "Handpicked heritage venues across Nepal's most sacred valleys.",
    eyebrow: "Authentic spaces · Living heritage · Nepal",
  },
  venueTypesIntro: {
    eyebrow: "Spaces",
    title: "Find your",
    accent: "perfect space",
    description:
      "Five kinds of space across Nepal's finest venues, each with its own character and atmosphere.",
  },
  venueTypes: [
    { slug: "heritage-courtyards", name: "Heritage Courtyards", imageKey: "heritageCourtyards", badgeKey: "heritageBadge" },
    { slug: "garden-estates", name: "Garden Estates", imageKey: "gardenEstates", badgeKey: "gardenBadge" },
    { slug: "intimate-halls", name: "Intimate Halls", imageKey: "intimateHalls", badgeKey: "intimateBadge" },
    { slug: "mountain-retreats", name: "Mountain Retreats", imageKey: "mountainRetreats", badgeKey: "mountainBadge" },
    { slug: "rooftop-terraces", name: "Rooftop Terraces", imageKey: "rooftopTerraces", badgeKey: "rooftopBadge" },
  ],
  storiesIntro: { eyebrow: "Venue stories", title: "Built for the", accent: "occasion" },
  stories: [
    {
      eyebrow: "Heritage",
      title: "The Newari courtyard",
      description:
        "Step inside a living Newari courtyard with carved wood brackets, terracotta friezes, and courtyards that have hosted celebrations for five centuries.",
      imageKey: "storyNewariCourtyard",
      imageSizes: "(min-width: 1280px) 900px, (min-width: 1024px) 70vw, 170vw",
      category: "heritage-courtyards",
      venueId: null,
    },
    {
      eyebrow: "Wedding",
      title: "Traditions, unbroken",
      description:
        "From teej-red to gold-draped mandap, our heritage venues hold space for every ritual with the reverence it deserves.",
      imageKey: "storyWedding",
      imageSizes: "(min-width: 1024px) 269px, (min-width: 640px) 50vw, 100vw",
      category: "garden-estates",
      venueId: null,
    },
    {
      eyebrow: "Ambience",
      title: "Candlelight and stone",
      description:
        "Long dining tables, amber candlelight, and centuries-old stone walls: the kind of evening that guests carry home in memory.",
      imageKey: "storyAmbience",
      imageSizes: "(min-width: 1024px) 269px, (min-width: 640px) 50vw, 100vw",
      category: "intimate-halls",
      venueId: null,
    },
  ],
  seasonsIntro: { eyebrow: "Seasons", title: "Plan around", accent: "the season" },
  seasons: [
    {
      name: "Spring",
      imageKey: "seasonSpring",
      title: "Bloom",
      description:
        "March to May: blossoming gardens, golden-hour ceremonies, and Nepal's most celebrated season for weddings.",
    },
    {
      name: "Summer",
      imageKey: "seasonSummer",
      title: "Oasis",
      description:
        "June to August: lush botanical backdrops, elegant indoor banquets, and intimate celebrations sheltered during Nepal's romantic monsoon season.",
    },
    {
      name: "Autumn",
      imageKey: "seasonAutumn",
      title: "Harvest",
      description:
        "September to November: clear Himalayan skies, festival lights, and celebrations rich with the spirit of Dashain and Tihar.",
    },
    {
      name: "Winter",
      imageKey: "seasonWinter",
      title: "Hearth",
      description:
        "December to February: crisp mountain air, candlelit interiors, and intimate gatherings warmed beside golden hearths and Himalayan views.",
    },
  ],
  featuredIntro: {
    eyebrow: "Our selection",
    title: "Our finest",
    accent: "heritage spaces",
    description:
      "Hand-curated from across Nepal's most storied valleys. Each space carries centuries of cultural memory and is dressed for your occasion.",
  },
  testimonialsIntro: { eyebrow: "Testimonials", title: "What guests say", accent: "after their event" },
  partnerCta: {
    eyebrow: "Partner with Venure",
    title: "List your venue.",
    accent: "Reach the right clientele.",
    description:
      "Venure connects Nepal's finest heritage spaces with clients who understand their worth. Join our curated collection.",
  },
};

module.exports = { LANDING_DEFAULTS };
