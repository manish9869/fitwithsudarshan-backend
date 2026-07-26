
// ─── BRAND ────────────────────────────────────────────────────────────────────
export const brand = {
    name: "FitWithSudarshan",
    system: "RECODE™",
    tagline: "Recode Your Body. Recode Your Life.",
    positioning: "Recovery-Based Transformation System",
};

// ─── COACH ────────────────────────────────────────────────────────────────────
export const coach = {
    name: "Sudarshan Chavan",
    firstName: "Sudarshan",
    certifications: ["American College of Sports Medicine (ACSM)"],
    yearsExperience: "8+",
    clientsGuided: "200+",
    personalTransformation: "29kg",
    shortBio:
        "I'm Sudarshan Chavan, founder of RECODE™. After transforming my own body from 85kg to 56kg, I realized lasting transformation requires more than workouts and diets. Today, I help clients improve body composition, movement quality, strength, energy, and lifestyle through a structured recovery-based coaching system.",
    longBio:
        "My transformation journey started with a personal goal of losing weight. Through years of learning and coaching, I discovered that sustainable transformation comes from fixing the body's foundation first. Poor recovery, weak movement patterns, stress, lack of structure, and inconsistent habits are often the real reasons people struggle. This led to the creation of RECODE™ — a recovery-based transformation system built around five pillars: Recover → Regulate → Restructure → Rebuild → Redefine. Today, RECODE helps people achieve sustainable fat loss, muscle gain, better mobility, improved energy, and long-term lifestyle change without relying on extreme methods.",
    stats: [
        { value: "29kg", label: "Personal Transformation" },
        { value: "200+", label: "Clients Guided" },
        { value: "8+", label: "Years Experience" },
        { value: "ACSM", label: "Certified Coach" },
    ],
};

// ─── CONTACT ──────────────────────────────────────────────────────────────────
export const contact = {
    phone: "9619708124",
    email: "Fitwithsudarshanofficial@gmail.com",
    location: "Mumbai, Maharashtra, India",
    social: {
        instagram: "https://www.instagram.com/fitwithsudarshan",
        youtube: "https://youtube.com/@sudarshanchavan1833",
        whatsapp: "https://wa.me/9619708124"
    },
};

// ─── RECODE 5R METHOD ─────────────────────────────────────────────────────────
export const recodeMethod = [
    {
        step: "01",
        title: "RECOVER",
        description: "Restore energy, recovery, and resilience.",
        color: "from-emerald-500/20 to-teal-500/20",
        accent: "text-emerald-400",
    },
    {
        step: "02",
        title: "REGULATE",
        description: "Create balance through nutrition and lifestyle.",
        color: "from-blue-500/20 to-cyan-500/20",
        accent: "text-blue-400",
    },
    {
        step: "03",
        title: "RESTRUCTURE",
        description: "Improve posture, mobility, and movement quality.",
        color: "from-violet-500/20 to-purple-500/20",
        accent: "text-violet-400",
    },
    {
        step: "04",
        title: "REBUILD",
        description: "Build strength, muscle, and physical confidence.",
        color: "from-orange-500/20 to-amber-500/20",
        accent: "text-orange-400",
    },
    {
        step: "05",
        title: "REDEFINE",
        description: "Create a sustainable lifestyle and identity.",
        color: "from-rose-500/20 to-pink-500/20",
        accent: "text-rose-400",
    },
];

// ─── SERVICES ─────────────────────────────────────────────────────────────────
export const services = [
    {
        id: "online",
        title: "RECODE ONLINE",
        subtitle: "Personalized coaching accessible worldwide.",
        features: [
            "Customized Workout Plan",
            "Customized Nutrition Plan",
            "Progress Tracking",
            "Weekly Accountability",
            "WhatsApp Support",
            "Habit Coaching",
        ],
        badge: null,
        color: "from-emerald-500/20 to-teal-500/20",
        accent: "text-emerald-400",
    },
    {
        id: "consult",
        title: "RECODE CONSULT",
        subtitle: "One-on-one online consultation sessions.",
        features: [
            "Movement Assessment",
            "Lifestyle Review",
            "Nutrition Guidance",
            "Recovery Analysis",
            "Action Plan",
        ],
        badge: null,
        color: "from-blue-500/20 to-cyan-500/20",
        accent: "text-blue-400",
    },
    {
        id: "personal",
        title: "RECODE PERSONAL",
        subtitle: "Private one-on-one coaching in Mumbai.",
        features: [
            "Personal Training Sessions",
            "Mobility Work",
            "Strength Training",
            "Fat Loss Coaching",
            "Lifestyle Support",
        ],
        badge: "Limited Availability",
        color: "from-orange-500/20 to-amber-500/20",
        accent: "text-orange-400",
    },
    {
        id: "elite",
        title: "RECODE ELITE",
        subtitle: "Premium coaching for high performers.",
        features: [
            "Priority Support",
            "Weekly Strategy Calls",
            "Advanced Progress Tracking",
            "Customized Roadmap",
            "Lifestyle Optimization",
        ],
        badge: "Premium",
        color: "from-violet-500/20 to-purple-500/20",
        accent: "text-violet-400",
    },
];

// ─── COACHING TYPES ──────────────────────────────────────────────────────────
export const coachingTypes = [
    {
        id: "online",
        name: "RECODE Online Coaching",
        shortName: "Online",
        tagline: "Diet, workout, habit guidance and WhatsApp-led support.",
        description:
            "Best for clients who want structured diet, workout, habit guidance and WhatsApp-led accountability without video calls or in-person sessions. Ideal for fat loss, muscle gain, routine correction and sustainable transformation from anywhere.",
        features: [
            "Customized workout plan",
            "Nutrition and diet guidance",
            "Indian meal strategy",
            "Habit and routine correction",
            "Weekly progress review",
            "WhatsApp-led support after enrollment",
            "Daily / weekly check-in system",
            "Lifestyle and recovery guidance",
            "Progress tracking",
            "Plan updates based on progress",
        ],
        cta: "Enroll in Online Coaching",
    },
    {
        id: "video",
        name: "RECODE Video Coaching",
        shortName: "Video",
        tagline: "Online coaching plus video review and consultation support.",
        description:
            "Best for clients who want online coaching plus direct video call guidance, review and correction. Ideal for people who need deeper explanation, personal review and stronger accountability.",
        features: [
            "Everything included in Online Coaching",
            "Scheduled video consultation / review calls",
            "12 sessions in a month",
            "Exercise form discussion",
            "Diet and routine review on call",
            "Progress discussion",
            "Roadmap correction based on video review",
            "Better for clients who need personal guidance and clarity",
        ],
        cta: "Enroll in Video Coaching",
    },
    {
        id: "personal",
        name: "RECODE Mumbai Personal Training",
        shortName: "Mumbai PT",
        tagline: "1-on-1 in-person training in Mumbai with nutrition and habit support.",
        description:
            "Premium one-to-one personal training in Mumbai for clients who want direct coaching, form correction, accountability and structured transformation support. Available for home, society gym, private gym or hybrid training.",
        features: [
            "12 one-to-one sessions per month",
            "Exercise form correction",
            "Strength and conditioning plan",
            "Fat-loss or muscle-building workout structure",
            "Nutrition and diet guidance",
            "Indian meal strategy",
            "Habit and routine correction",
            "Weekly progress review",
            "WhatsApp-led support after enrollment",
            "Mobility, posture and recovery guidance",
            "Progress tracking",
            "Plan adjustments based on progress",
        ],
        note: "Mumbai Personal Training includes 12 one-to-one sessions per month. Final onboarding depends on location, timing and trainer availability.",
        cta: "Enroll in Mumbai Personal Training",
    },
];

// pricing[coachingTypeId][planType][duration] = price
export const pricingTable = {
    online: {
        individual: {
            "1": 1999,
            "3": 3999,
            "6": 6999,
            "12": 15999,
        },
        couple: {
            "1": 4999,
            "3": 12999,
            "6": 22999,
            "12": 38999,
        },
        // NEW — one-time basic consultation, online only
        basic_individual: {
            "1": 99,
        },
        basic_couple: {
            "1": 199,
        },
    },
    video: {
        individual: {
            "1": 10000,
            "3": 28000,
            "6": 55000,
            "12": 100000,
        },
        couple: {
            "1": 18000,
            "3": 50000,
            "6": 100000,
            "12": 180000,
        },
    },
    personal: {
        individual: {
            "1": 20000,
            "3": 55000,
            "6": 105000,
            "12": 200000,
        },
        couple: {
            "1": 35000,
            "3": 70000,
            "6": 120000,
            "12": 220000,
        },
    },
};

// ─── BASIC ONLINE CONSULTATION (one-time, online tab only) ───────────────────
export const basicConsultation = {
    coachingId: "basic",
    name: "RECODE Comeback Blueprint",
    tagline: "One-time basic guidance — nutrition & workout direction.",
    description:
        "A single one-time consultation with basic nutrition and workout guidance. Ideal if you just want a starting roadmap rather than full ongoing coaching.",
    priceIndividual: 99,
    priceCouple: 199,
    originalPriceIndividual: 599,
    originalPriceCouple: 999,
    saleLabel: "Hot Sale",
    features: [
        "One-time basic workout guidance",
        "One-time basic nutrition guidance",
        "General direction & roadmap",
        "No ongoing check-ins (upgrade to full coaching anytime)",
    ],
};

export const durations = [
    { months: "1", label: "1 Month", sublabel: "Starter", description: "Start with structure and direction." },
    { months: "3", label: "3 Months", sublabel: "Foundation", description: "Build routine, food control and visible progress.", popular: true },
    { months: "6", label: "6 Months", sublabel: "Most Popular", description: "Best for serious transformation and consistency." },
    { months: "12", label: "12 Months", sublabel: "Best Value", description: "Best for complete body and lifestyle rebuild." },
];

// ─── WHAT'S INCLUDED IN ALL PLANS ────────────────────────────────────────────
export const planInclusions = [
    "Personalized workout structure",
    "Nutrition and diet guidance",
    "Indian food-based meal strategy",
    "Habit and routine correction",
    "Weekly progress review",
    "WhatsApp onboarding and support after enrollment",
    "Check-in system",
    "Lifestyle and recovery guidance",
    "Mindset and consistency support",
    "Progress tracking",
    "Plan updates based on response",
    "Plateau correction when needed",
];

// ─── LEGACY PRICING (kept for reference) ─────────────────────────────────────
export const pricing = [
    {
        name: "RECODE FOUNDATION",
        duration: "Monthly",
        regularPrice: 599,
        foundingPrice: 599,
        isFoundingDifferent: false,
        features: ["Monthly Workout Plan", "Monthly Nutrition Guidelines", "RECODE Community Access", "Educational Resources", "Monthly Check-In"],
        popular: false,
        cta: "Get Started",
        badge: null,
    },
    {
        name: "RECODE START",
        duration: "Monthly",
        regularPrice: 4999,
        foundingPrice: 2999,
        isFoundingDifferent: true,
        features: ["Customized Workout Plan", "Customized Nutrition Plan", "Weekly Accountability", "WhatsApp Support", "Habit Coaching", "Progress Tracking"],
        popular: false,
        cta: "Apply Now",
        badge: null,
    },
    {
        name: "RECODE TRANSFORM",
        duration: "3 Months",
        regularPrice: 11999,
        foundingPrice: 7999,
        isFoundingDifferent: true,
        features: ["Everything in RECODE START", "3-Month Structured Program", "Bi-Weekly Check-ins", "Nutrition Plan Updates", "Recovery Protocols", "Movement Assessment"],
        popular: true,
        cta: "Apply Now",
        badge: "Most Popular",
    },
    {
        name: "RECODE EVOLVE",
        duration: "6 Months",
        regularPrice: 20999,
        foundingPrice: 14999,
        isFoundingDifferent: true,
        features: ["Everything in TRANSFORM", "6-Month Full Transformation", "Weekly Strategy Calls", "Advanced Tracking", "Lifestyle Systems", "Priority WhatsApp", "Mobility Program"],
        popular: false,
        cta: "Apply Now",
        badge: "Recommended",
    },
    {
        name: "RECODE ELITE",
        duration: "12 Months",
        regularPrice: 35999,
        foundingPrice: 24999,
        isFoundingDifferent: true,
        features: ["Everything in EVOLVE", "12-Month Full Journey", "Weekly 1:1 Calls", "Full Lifestyle Audit", "Custom Recovery Plan", "Competition Prep Ready", "Lifetime Community Access", "1-on-1 Accountability Partner"],
        popular: false,
        cta: "Apply Now",
        badge: "Best Value",
    },
];

// ─── TESTIMONIALS ─────────────────────────────────────────────────────────────
export const testimonials = [
    {
        id: 1,
        name: "Prajvati",
        role: "Anesthetist",
        transformation: "80kg → 56kg",
        weightLost: "24kg Lost",
        quote: "What stood out about RECODE was its focus on sustainability and lifestyle integration. It wasn't about following a strict diet — it was about building habits that fit my routine and delivered lasting results.",
        rating: 5,
        avatar: null,
    },
    {
        id: 2,
        name: "Aayush",
        role: "Finance Professional",
        transformation: "82kg → 71kg",
        weightLost: "11kg Lost",
        quote: "RECODE helped me build sustainable habits around nutrition and training, leading to an 11kg transformation without extreme dieting. The process was practical, easy to follow, and fit perfectly into my busy schedule.",
        rating: 5,
        avatar: null,
    },
    {
        id: 3,
        name: "Joshua",
        role: "Producer",
        transformation: "95kg → 80kg",
        weightLost: "15kg Lost",
        quote: "RECODE gave me a practical structure that fit my lifestyle instead of forcing me into a restrictive diet. Over 3 months, I lost 15kg while building habits that I could realistically maintain long-term.",
        rating: 5,
        avatar: null,
    },
    {
        id: 4,
        name: "Raj",
        role: "Actor",
        transformation: "85kg → 70kg",
        weightLost: "15kg Lost",
        quote: "RECODE gave me a structured and sustainable approach to nutrition and training that fit my schedule. In just 3 months, I transformed my physique while improving my energy and confidence.",
        rating: 5,
        avatar: null,
    },
    {
        id: 5,
        name: "Jinal",
        role: "Working Professional",
        transformation: "65kg → 58kg",
        weightLost: "8kg Lost",
        quote: "I had tried many trainers and diets before but nothing worked. With RECODE, I finally understood how to follow fitness in a structured and sustainable way. For the first time, I felt like I was building a better routine, not just dieting.",
        rating: 5,
        avatar: null,
    },
    {
        id: 6,
        name: "Juzer",
        role: "Business Professional",
        transformation: "85kg → 75kg",
        weightLost: "10kg Lost",
        quote: "Because of travelling and work, maintaining diet and workouts was always difficult. With RECODE, things became more structured and manageable. I lost 10kg in 3 months and the process felt practical even with my lifestyle.",
        rating: 5,
        avatar: null,
    },
    {
        id: 7,
        name: "Lalitesh",
        role: "Business Owner",
        transformation: "87kg → 80kg",
        weightLost: "7kg Lost",
        quote: "RECODE made the process simple for me. It gave me structure, accountability, and a plan that actually fit my lifestyle. This is the first time fitness did not feel forced or complicated.",
        rating: 5,
        avatar: null,
    },
    {
        id: 8,
        name: "Sudarshan Chavan",
        role: "Founder, RECODE™",
        transformation: "85kg → 56kg",
        weightLost: "29kg Lost",
        quote: "After struggling with inconsistency, extreme approaches, and the cycle of starting over, I realized that lasting results come from structure, not restriction. I transformed from 85kg to 56kg and built a lifestyle I could actually sustain.",
        rating: 5,
        avatar: null,
    },
];
// ─── BLOG POSTS ───────────────────────────────────────────────────────────────
export const blogPosts = [
    {
        id: 1, slug: "why-recovery-is-the-missing-piece",
        title: "Why Recovery Is the Missing Piece in Your Transformation",
        excerpt: "Most people train harder when results stall. The real answer is almost always the opposite. Here's why recovery is the most underrated tool in fitness.",
        category: "Recovery", readTime: "5 min read", date: "Jan 10, 2025",
        image: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=600&h=340&fit=crop&q=80",
        content: `## Why Recovery Is the Missing Piece in Your Transformation

Most people train harder when results stall. More sessions. More cardio. Stricter diet.

The real answer is almost always the opposite.

### What Is Recovery, Really?

Recovery isn't just rest days. It's the full process by which your body adapts to training, repairs tissue, regulates hormones, and rebuilds energy systems.

Poor recovery shows up as:
- Persistent fatigue that doesn't go away with sleep
- Stalled progress despite consistent training
- Frequent illness or injury
- Mood swings, irritability, and brain fog
- Poor sleep quality

### The Stress-Recovery Equation

Your body cannot distinguish between training stress and life stress. Work deadlines, poor sleep, relationship tension, financial worry — these all count toward your total stress load.

When your stress bucket overflows, your body prioritizes survival over transformation. Fat loss slows. Muscle gain stops. Recovery takes longer.

### The RECODE Approach

In RECODE™, recovery is the first pillar for a reason. Before we optimize nutrition or add training volume, we assess and restore your recovery foundation:

1. **Sleep quality** — the single most powerful recovery tool
2. **Stress management** — regulating cortisol and the nervous system
3. **Movement quality** — reducing compensations that create chronic fatigue
4. **Nutrition timing** — supporting recovery through strategic eating

### The Bottom Line

If you've been grinding harder with diminishing returns, recovery is likely the missing piece. Train smart, recover harder, and watch your results accelerate.`,
    },
    {
        id: 2, slug: "fat-loss-without-starving",
        title: "Fat Loss Without Starving: The RECODE Nutrition Approach",
        excerpt: "Extreme calorie restriction slows your metabolism, kills muscle, and destroys your relationship with food. Here's a smarter way.",
        category: "Fat Loss", readTime: "6 min read", date: "Jan 18, 2025",
        image: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&h=340&fit=crop&q=80",
        content: `## Fat Loss Without Starving: The RECODE Nutrition Approach

Extreme calorie restriction slows your metabolism, kills muscle, and destroys your relationship with food.

There is a smarter way.

### The Problem With Most Fat Loss Diets

Most diets operate on one principle: eat as little as possible.

**Metabolic adaptation** — your body is smart. When you chronically undereat, it downregulates metabolism to match your intake.

**Muscle loss** — without adequate protein and progressive training, your body breaks down muscle for energy.

**Hormonal disruption** — severe restriction elevates cortisol, suppresses testosterone and thyroid function.

### The RECODE Nutrition Philosophy

1. **Eat enough to support transformation** — a moderate deficit of 300-500 calories
2. **Prioritize protein** — 1.6-2.2g per kg of bodyweight daily
3. **Build structure, not restriction** — flexible approach that allows real life
4. **Adjust, don't crash** — small strategic adjustments over time

### The Result

Sustainable fat loss. Preserved muscle. Better energy. A healthy relationship with food.`,
    },
    {
        id: 3, slug: "mobility-the-forgotten-component",
        title: "Mobility: The Forgotten Component That Unlocks Everything",
        excerpt: "If you can't squat without your heels lifting, press overhead without pain, or sit on the floor comfortably — mobility training is non-negotiable.",
        category: "Mobility", readTime: "5 min read", date: "Jan 25, 2025",
        image: "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=600&h=340&fit=crop&q=80",
        content: `## Mobility: The Forgotten Component That Unlocks Everything

If you can't squat without your heels lifting, press overhead without pain, or sit comfortably on the floor — mobility training is non-negotiable.

### What Is Mobility?

Mobility is active control through a joint's range of motion. Good mobility means:
- Moving freely without compensation
- Loading joints safely through full range
- Reducing injury risk
- Improving performance in every movement

### Simple Daily Mobility Routine

1. **90/90 hip stretch** — 60 seconds each side
2. **Thoracic rotation** — 10 reps each side
3. **Ankle circles and dorsiflexion work** — 60 seconds each
4. **Cat-cow** — 10 slow reps
5. **Deep squat hold** — 60 seconds

Perform this daily. Results appear within 2-4 weeks.`,
    },
    {
        id: 4, slug: "building-muscle-the-smart-way",
        title: "Building Muscle the Smart Way: The RECODE Approach to Hypertrophy",
        excerpt: "More volume isn't always better. More intensity isn't always better. Here's what the science actually says about building muscle efficiently.",
        category: "Muscle Building", readTime: "7 min read", date: "Feb 3, 2025",
        image: "https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=600&h=340&fit=crop&q=80",
        content: `## Building Muscle the Smart Way

More volume isn't always better. More intensity isn't always better.

### The Three Mechanisms of Hypertrophy

**1. Mechanical tension** — the force applied to muscle fibers during contraction. The most important driver.

**2. Metabolic stress** — the accumulation of metabolites during training. The "pump."

**3. Muscle damage** — microtrauma to muscle fibers that triggers repair and growth.

### Progressive Overload: The Non-Negotiable

The single most important principle in muscle building. Achieve it by:
- Adding weight to the bar
- Adding reps with the same weight
- Improving range of motion
- Slowing the eccentric (lowering) phase`,
    },
    {
        id: 5, slug: "sleep-your-secret-weapon",
        title: "Sleep: Your Most Powerful Transformation Tool",
        excerpt: "You can have the perfect training program and nutrition plan. If you're sleeping 5 hours a night, you're leaving 70% of your results on the table.",
        category: "Recovery", readTime: "5 min read", date: "Feb 12, 2025",
        image: "https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?w=600&h=340&fit=crop&q=80",
        content: `## Sleep: Your Most Powerful Transformation Tool

If you're sleeping 5 hours a night, you're leaving 70% of your results on the table.

### Building a Sleep Protocol

**Consistency first** — same bedtime and wake time 7 days a week.

**Temperature** — cool room (18-20°C) promotes deeper sleep.

**Darkness** — blackout curtains or sleep mask.

**Wind-down routine** — 30-60 minutes of low stimulation before bed.

**Limit caffeine** — half-life of caffeine is 5-7 hours. Coffee at 3pm still affects you at 10pm.`,
    },
    {
        id: 6, slug: "mindset-for-sustainable-transformation",
        title: "The Mindset Shift That Makes Transformation Sustainable",
        excerpt: "The difference between people who transform permanently and those who yo-yo forever isn't discipline. It's identity.",
        category: "Mindset", readTime: "6 min read", date: "Feb 20, 2025",
        image: "https://images.unsplash.com/photo-1434682881908-b43d0467b798?w=600&h=340&fit=crop&q=80",
        content: `## The Mindset Shift That Makes Transformation Sustainable

The difference between people who transform permanently and those who yo-yo forever isn't discipline.

It's identity.

### How to Build a New Identity

**1. Vote for who you want to become** — every workout, every nutritious meal is a vote.

**2. Change your environment** — set up your space to make healthy choices easy.

**3. Join a community** — identity is social. We become who we're surrounded by.

**4. Celebrate process, not outcomes** — process goals create a permanent lifestyle.

**5. Reframe setbacks** — missing a workout isn't failure. What matters is the response.`,
    },
    {
        id: 7, slug: "protein-101-how-much-do-you-really-need",
        title: "Protein 101: How Much Do You Really Need to Build Muscle?",
        excerpt: "The fitness industry is obsessed with protein — but most people are either eating way too little or way too much. Here's what the science says.",
        category: "Nutrition", readTime: "6 min read", date: "Mar 5, 2025",
        image: "https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=600&h=340&fit=crop&q=80",
        content: `## Protein 101: How Much Do You Really Need?

The fitness industry is obsessed with protein. Shake ads, meal preps, macro trackers — protein is everywhere. But most people are eating too little or too much.

### What Does Protein Actually Do?

Protein is the raw material for muscle repair and growth. It also:
- Keeps you feeling full longer
- Has the highest thermic effect of food (burns ~25% of calories to digest)
- Supports immune function, hormones, and enzymes

### The Research-Backed Sweet Spot

Current evidence points to **1.6–2.2g per kg of bodyweight** per day for most active people.

- 70kg person → 112–154g protein/day
- 80kg person → 128–176g protein/day

Going higher (up to 3g/kg) isn't harmful for most people, but offers diminishing returns.

### Best Protein Sources

**Animal:** Chicken breast, eggs, Greek yogurt, cottage cheese, lean beef, fish
**Plant:** Lentils, chickpeas, tofu, tempeh, edamame, seitan

### Timing Matters — But Less Than You Think

**Distribute across meals.** Aim for 30–40g per meal rather than trying to eat it all at once. Post-workout protein within 2 hours helps, but the total daily intake matters far more.`,
    },
    {
        id: 8, slug: "hiit-vs-steady-state-cardio",
        title: "HIIT vs Steady-State Cardio: Which Burns More Fat?",
        excerpt: "Both have a place in a smart training plan. But depending on your goal, recovery capacity, and schedule — one will serve you significantly better.",
        category: "Workouts", readTime: "5 min read", date: "Mar 14, 2025",
        image: "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=600&h=340&fit=crop&q=80",
        content: `## HIIT vs Steady-State Cardio: Which Burns More Fat?

The debate has raged for years. Both camps have passionate followers. But the real answer is nuanced.

### What Is HIIT?

High-Intensity Interval Training alternates short bursts of maximum effort with recovery periods. Example: 30 seconds sprint / 90 seconds walk, repeated 8–10 times.

**Benefits:**
- Burns more calories in less time
- Elevates metabolism for hours after (EPOC effect)
- Preserves muscle mass better than long cardio
- Improves cardiovascular fitness rapidly

**Drawbacks:**
- High recovery demand — limits training frequency
- Can increase cortisol if overused
- Not ideal when already stressed or under-recovered

### What Is Steady-State Cardio?

Low-to-moderate intensity maintained for 30–60+ minutes. Think: brisk walk, jog, cycling.

**Benefits:**
- Low recovery cost — can be done daily
- Reduces cortisol and aids recovery
- Burns fat directly during activity
- Improves aerobic base and heart health

**Drawbacks:**
- More time required for equivalent calorie burn
- Can interfere with strength gains if overdone

### The RECODE Verdict

**Use both strategically.** For most clients, we recommend:
- **2–3 days steady-state** (walks, light cycling) — great for recovery and fat burning
- **1–2 days HIIT** — when energy is high and recovery is solid

Never sacrifice sleep or recovery for more cardio.`,
    },
];

// ─── WHO IS RECODE FOR ────────────────────────────────────────────────────────
export const targetAudience = [
    "Busy Professionals",
    "Entrepreneurs",
    "Corporate Executives",
    "Creators & Influencers",
    "Students",
    "Beginners Starting Their Fitness Journey",
    "Anyone Seeking Sustainable Transformation",
];

// ─── WHY RECODE ───────────────────────────────────────────────────────────────
export const whyRecode = {
    others: [
        "Restrictive diets",
        "Endless cardio",
        "Short-term challenges",
        "Quick fixes",
    ],
    recode: [
        "Recovery",
        "Structure",
        "Movement Quality",
        "Nutrition",
        "Lifestyle Systems",
        "Sustainable Results",
    ],
};