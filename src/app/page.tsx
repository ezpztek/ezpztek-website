import Image from "next/image";
import ContactForm from "@/components/contact-form";

type IconName =
  | "inventory"
  | "workflow"
  | "chart"
  | "custom"
  | "product"
  | "check";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    inventory: (
      <>
        <path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" />
        <path d="M4 7.5V16l8 5 8-5V7.5M12 12v9" />
      </>
    ),
    workflow: (
      <>
        <rect x="3" y="3" width="6" height="6" rx="1.5" />
        <rect x="15" y="15" width="6" height="6" rx="1.5" />
        <path d="M9 6h4a3 3 0 0 1 3 3v6M15 18h-4a3 3 0 0 1-3-3V9" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        <path d="m4 7 6-4 6 7 5-4" />
      </>
    ),
    custom: (
      <>
        <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
        <path d="m8.5 12 2.2 2.2 4.8-5" />
      </>
    ),
    product: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 4v5M16 4v5M7 14h3M14 14h3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

type SelectedBuild = {
  name: string;
  category: string;
  market: string;
  description: string;
  variant: "meal" | "arc" | "government";
  href?: string;
  domain?: string;
  image?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
};

const selectedBuilds: SelectedBuild[] = [
  {
    name: "The Meal Guides",
    category: "Food ordering",
    market: "Philippines",
    description:
      "An online ordering experience that helps customers discover merchants, menus, and meals in one place.",
    variant: "meal",
    href: "https://orders.themealguides.com",
    domain: "orders.themealguides.com",
    image: "/themealguides-logo.png",
    imageAlt: "The Meal Guides logo",
    imageWidth: 1920,
    imageHeight: 1080,
  },
  {
    name: "The Meal Guides Ghana",
    category: "Food ordering",
    market: "Ghana",
    description:
      "A dedicated ordering platform bringing The Meal Guides experience to its Ghana market.",
    variant: "meal",
    href: "https://gh.themealguides.com",
    domain: "gh.themealguides.com",
    image: "/themealguides-logo.png",
    imageAlt: "The Meal Guides logo",
    imageWidth: 1920,
    imageHeight: 1080,
  },
  {
    name: "Arc Fitness Gym",
    category: "Fitness",
    market: "Philippines",
    description:
      "A focused digital home for gym information, offers, and customer inquiries.",
    variant: "arc",
    href: "https://arcfitnessgym.vercel.app",
    domain: "arcfitnessgym.vercel.com",
    image: "/arc-fitness-logo.jpg",
    imageAlt: "Arc Fitness Gym logo",
    imageWidth: 2048,
    imageHeight: 960,
  },
  {
    name: "Local Government Digitalization",
    category: "Public-sector systems",
    market: "Local government",
    description:
      "A paper-to-database workflow that makes local health records easier to organize, search, and maintain.",
    variant: "government",
  },
];

function SelectedBuildCard({
  project,
  duplicate = false,
}: {
  project: SelectedBuild;
  duplicate?: boolean;
}) {
  const content = (
    <>
      <div className="build-card-head">
        <span>{project.category}</span>
        <span>{project.market}</span>
      </div>
      <div className="build-logo">
        {project.image ? (
          <Image
            src={project.image}
            alt={duplicate ? "" : project.imageAlt || ""}
            width={project.imageWidth || 1200}
            height={project.imageHeight || 700}
            sizes="(max-width: 780px) 84vw, 430px"
          />
        ) : (
          <div className="government-mark" aria-hidden="true">
            <Icon name="workflow" />
            <strong>LGU</strong>
            <span>Digital records</span>
          </div>
        )}
      </div>
      <div className="build-card-copy">
        <h3>{project.name}</h3>
        <p>{project.description}</p>
        <div className="build-card-action">
          <span>{project.domain || "Private digitalization project"}</span>
          <strong>{project.href ? "Visit site ↗" : "Case study soon"}</strong>
        </div>
      </div>
    </>
  );

  if (project.href) {
    return (
      <a
        className={`build-card build-card-${project.variant}`}
        href={project.href}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={duplicate ? -1 : undefined}
        aria-label={duplicate ? undefined : `Visit ${project.name} website (opens in a new tab)`}
      >
        {content}
      </a>
    );
  }

  return <article className={`build-card build-card-${project.variant}`}>{content}</article>;
}

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  name: "EZPZTEK",
  description:
    "Practical custom software, workflow automation, and digital systems for Filipino SMEs.",
  areaServed: "Philippines",
  serviceType: [
    "Custom software development",
    "Business process digitalization",
    "Workflow automation",
    "SaaS product development",
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />

      <header className="site-header">
        <div className="shell header-inner">
          <a className="brand" href="#top" aria-label="EZPZTEK home">
            <span className="brand-image">
              <Image
                src="/ezpztek-logo.png"
                alt=""
                width={663}
                height={623}
                priority
              />
            </span>
            <span>EZPZTEK</span>
          </a>

          <nav className="desktop-nav" aria-label="Primary navigation">
            <a href="#solutions">Solutions</a>
            <a href="#work">Work</a>
            <a href="#process">Process</a>
            <a href="#about">About</a>
          </nav>

          <a className="button button-small button-dark header-cta" href="#contact">
            Book a free consultation
          </a>

          <details className="mobile-menu">
            <summary aria-label="Open navigation">Menu</summary>
            <nav aria-label="Mobile navigation">
              <a href="#solutions">Solutions</a>
              <a href="#work">Work</a>
              <a href="#process">Process</a>
              <a href="#about">About</a>
              <a href="#contact">Book a free consultation</a>
            </nav>
          </details>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="shell hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">Software for Filipino SMEs</p>
              <h1>
                Less paperwork.
                <br />
                <span>Better control.</span>
              </h1>
              <p className="hero-lede">
                EZPZTEK helps growing businesses replace scattered spreadsheets,
                paper records, and repetitive manual work with practical digital
                systems their teams can actually use.
              </p>
              <div className="hero-actions">
                <a className="button button-coral" href="#contact">
                  Book a free process consultation
                </a>
                <a className="text-link" href="#work">
                  See selected work
                </a>
              </div>
              <div className="hero-tags" aria-label="Areas of expertise">
                <span>Inventory</span>
                <span>Operations</span>
                <span>Data systems</span>
              </div>
            </div>

            <div className="hero-visual" aria-label="Manual work becoming a clear digital system">
              <div className="visual-kicker">
                <span className="status-dot" />
                One clearer way to run the day
              </div>
              <div className="visual-stage">
                <div className="paper-panel">
                  <div className="panel-label">Before</div>
                  <div className="paper-title">Daily inventory log</div>
                  <div className="paper-row"><span>Item</span><span>Count</span></div>
                  <div className="paper-row"><span>Rice bags</span><span className="scribble">26?</span></div>
                  <div className="paper-row"><span>Cooking oil</span><span className="scribble">08</span></div>
                  <div className="paper-row"><span>Packaging</span><span className="scribble">later</span></div>
                  <div className="paper-note">update sa Friday</div>
                </div>

                <div className="flow-mark" aria-hidden="true">
                  <Image src="/ezpztek-logo.png" alt="" width={663} height={623} />
                </div>

                <div className="system-panel">
                  <div className="system-head">
                    <div>
                      <div className="panel-label">After</div>
                      <strong>Operations overview</strong>
                    </div>
                    <span>Live</span>
                  </div>
                  <div className="metric-grid">
                    <div><small>In stock</small><b>142</b></div>
                    <div><small>Needs action</small><b>06</b></div>
                  </div>
                  <div className="chart-bars" aria-hidden="true">
                    <i style={{ height: "38%" }} />
                    <i style={{ height: "58%" }} />
                    <i style={{ height: "45%" }} />
                    <i style={{ height: "76%" }} />
                    <i style={{ height: "88%" }} />
                    <i style={{ height: "68%" }} />
                  </div>
                  <div className="system-update">
                    <Icon name="check" /> Stock movement recorded
                  </div>
                </div>
              </div>
              <p className="visual-caption">Your process first. Technology second.</p>
            </div>
          </div>
        </section>

        <section className="pain-section" aria-labelledby="pain-title">
          <div className="shell">
            <div className="section-heading section-heading-light">
              <p className="eyebrow eyebrow-light">Sound familiar?</p>
              <h2 id="pain-title">
                Your business has outgrown its tools—
                <span>not its people.</span>
              </h2>
            </div>
            <div className="pain-grid">
              <article>
                <span>01</span>
                <h3>Inventory lives everywhere</h3>
                <p>Notebook counts, separate Excel files, and updates made “sa oras na may time.”</p>
              </article>
              <article>
                <span>02</span>
                <h3>Reports arrive too late</h3>
                <p>By the time numbers are consolidated, the decision has already passed.</p>
              </article>
              <article>
                <span>03</span>
                <h3>Follow-ups run the day</h3>
                <p>Approvals and status updates disappear inside calls, paper forms, and Messenger threads.</p>
              </article>
              <article>
                <span>04</span>
                <h3>Growth adds more manual work</h3>
                <p>Every new branch, person, or order creates another file to maintain.</p>
              </article>
            </div>
            <p className="pain-close">
              These are not small inconveniences. They become the ceiling on how confidently your business can grow.
            </p>
          </div>
        </section>

        <section className="section solutions-section" id="solutions">
          <div className="shell">
            <div className="section-heading split-heading">
              <div>
                <p className="eyebrow">What we build</p>
                <h2>Built for how your business actually operates.</h2>
              </div>
              <p>
                We do not force your team into an oversized system. We understand the
                workflow first, then choose the simplest useful way to digitalize it.
              </p>
            </div>

            <div className="solution-paths">
              <article className="solution-card solution-card-dark">
                <div className="card-topline">
                  <span>01</span>
                  <div className="service-icon"><Icon name="custom" /></div>
                </div>
                <p className="card-kicker">Custom development</p>
                <h3>A system designed around your process.</h3>
                <p>
                  Best when your workflow is specific, creates an advantage, or cannot be handled well by off-the-shelf tools.
                </p>
                <ul>
                  <li><Icon name="check" /> Point-of-sale and inventory</li>
                  <li><Icon name="check" /> Internal operations platforms</li>
                  <li><Icon name="check" /> Records and reporting systems</li>
                </ul>
              </article>

              <article className="solution-card solution-card-coral">
                <div className="card-topline">
                  <span>02</span>
                  <div className="service-icon"><Icon name="product" /></div>
                </div>
                <p className="card-kicker">Productized software</p>
                <h3>Focused tools you can adopt faster.</h3>
                <p>
                  Best when a proven product workflow already fits the need and you want to start with less custom development.
                </p>
                <ul>
                  <li><Icon name="check" /> Ordering and booking workflows</li>
                  <li><Icon name="check" /> Business management platforms</li>
                  <li><Icon name="check" /> Configurable cloud-based tools</li>
                </ul>
              </article>
            </div>

            <div className="use-case-grid" aria-label="Common use cases">
              <article><Icon name="inventory" /><h3>Know what is in stock</h3><p>Track movements from one reliable source instead of reconciling multiple files.</p></article>
              <article><Icon name="workflow" /><h3>Move work forward</h3><p>Give requests, approvals, and responsibilities a clear status and owner.</p></article>
              <article><Icon name="chart" /><h3>See what needs attention</h3><p>Turn operational data into useful reports without manual consolidation.</p></article>
            </div>
          </div>
        </section>

        <section className="section work-section" id="work">
          <div className="shell">
            <div className="section-heading split-heading">
              <div>
                <p className="eyebrow">Selected builds</p>
                <h2>Real systems for real operating problems.</h2>
              </div>
              <p>
                A growing portfolio of ordering, fitness, and public-sector systems. Select a live project to visit its website.
              </p>
            </div>
          </div>

          <div className="build-marquee" aria-label="Selected EZPZTEK projects">
            <div className="build-marquee-track">
              <div className="build-marquee-group">
                {selectedBuilds.map((project) => (
                  <SelectedBuildCard key={project.name} project={project} />
                ))}
              </div>
              <div className="build-marquee-group" aria-hidden="true">
                {selectedBuilds.map((project) => (
                  <SelectedBuildCard
                    key={`${project.name}-duplicate`}
                    project={project}
                    duplicate
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section process-section" id="process">
          <div className="shell process-grid">
            <div className="process-intro">
              <p className="eyebrow">How we work</p>
              <h2>Start with one painful process. Grow from there.</h2>
              <p>
                Hindi kailangang sabay-sabay. We begin where delay, confusion, or repetitive work is costing your team the most.
              </p>
              <a className="text-link" href="#contact">Discuss your first process</a>
            </div>

            <ol className="process-list">
              <li><span>01</span><div><h3>Discover</h3><p>Map how the work happens today—including the undocumented workarounds.</p></div></li>
              <li><span>02</span><div><h3>Plan</h3><p>Define the smallest useful solution, clear scope, and practical next step.</p></div></li>
              <li><span>03</span><div><h3>Build together</h3><p>Review working versions early so the system reflects how the team operates.</p></div></li>
              <li><span>04</span><div><h3>Launch and improve</h3><p>Support adoption, learn from real use, and expand only where it adds value.</p></div></li>
            </ol>
          </div>
        </section>

        <section className="section about-section" id="about">
          <div className="shell about-grid">
            <div className="about-mark" aria-hidden="true">
              <Image src="/ezpztek-logo.png" alt="" width={663} height={623} />
            </div>
            <div className="about-copy">
              <p className="eyebrow eyebrow-light">Why EZPZTEK</p>
              <h2>Good software starts with understanding the business.</h2>
              <p className="about-lede">
                EZPZTEK combines a background in Computer Engineering Technology and Statistics with a practical view of day-to-day SME operations.
              </p>
              <p>
                That means asking better questions, organizing the data properly, and explaining decisions in plain language—not adding technology for its own sake.
              </p>
              <div className="principle-row">
                <div><strong>Clear scope</strong><span>Know what is being built and why.</span></div>
                <div><strong>Useful by design</strong><span>Make the workflow easy for the team to adopt.</span></div>
                <div><strong>Ready for growth</strong><span>Design with security and future expansion in mind.</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="section faq-section" id="faq">
          <div className="shell faq-grid">
            <div className="faq-intro">
              <p className="eyebrow">Common questions</p>
              <h2>Before we start.</h2>
              <p>Clear answers make it easier to decide whether digitalization is the right next step.</p>
            </div>
            <div className="faq-list">
              <details open>
                <summary>Do we need to replace everything we already use?</summary>
                <p>No. We first identify what works, what causes friction, and where a focused system or integration can create the most value.</p>
              </details>
              <details>
                <summary>Can you work with a process that is still paper-based?</summary>
                <p>Yes. Paper-based workflows can be mapped and digitized gradually so the transition stays manageable for the team.</p>
              </details>
              <details>
                <summary>How much does custom software cost?</summary>
                <p>It depends on scope, users, integrations, and rollout needs. A first consultation helps define the smallest useful version before a proposal is prepared.</p>
              </details>
              <details>
                <summary>How long does a project take?</summary>
                <p>Focused systems can move faster than broad platforms. The timeline is confirmed only after the workflow and required features are understood.</p>
              </details>
              <details>
                <summary>What happens after launch?</summary>
                <p>Launch planning can include onboarding, feedback, fixes, and a roadmap for future improvements based on real usage.</p>
              </details>
            </div>
          </div>
        </section>

        <section className="contact-section" id="contact">
          <div className="shell contact-grid">
            <div className="contact-copy">
              <p className="eyebrow">Free process consultation</p>
              <h2>What feels harder than it should?</h2>
              <p>
                Tell us the process that creates the most delay, duplicate work, or uncertainty. We’ll help identify a practical first step.
              </p>
              <div className="contact-promise">
                <Icon name="check" />
                <span>No technical brief required. Start with the business problem.</span>
              </div>
            </div>
            <ContactForm />
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="shell footer-main">
          <div>
            <a className="brand brand-footer" href="#top">
              <span className="brand-image"><Image src="/ezpztek-logo.png" alt="" width={663} height={623} /></span>
              <span>EZPZTEK</span>
            </a>
            <p>Practical digital systems for growing Filipino businesses.</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#solutions">Solutions</a>
            <a href="#work">Selected work</a>
            <a href="#process">Process</a>
            <a href="#faq">FAQ</a>
          </nav>
          <a className="footer-cta" href="#contact">Book a free consultation</a>
        </div>
        <div className="shell footer-bottom">
          <span>© {new Date().getFullYear()} EZPZTEK</span>
          <span>Built in the Philippines for businesses ready to work smarter.</span>
        </div>
      </footer>
    </>
  );
}
