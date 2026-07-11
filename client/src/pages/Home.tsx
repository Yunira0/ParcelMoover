import React from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { ArrowRight, Wallet, ShieldCheck, Truck, Phone, PackageSearch, ClipboardCheck, Radio } from 'lucide-react';
import TrackSearchBox from '../components/TrackSearchBox';
import { PHONE_DISPLAY, PHONE_TEL } from '../constants/contact';
import './Home.css';

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1781276532606-12957bd9a930?auto=format&fit=crop&w=1920&q=80';
const STREET_IMAGE =
  'https://images.unsplash.com/photo-1781637773536-5188b1f1f569?auto=format&fit=crop&w=1200&q=80';

// Exponential ease-out — no bounce, matches the calm/precise brand voice.
const EASE = [0.16, 1, 0.3, 1] as const;

const Home: React.FC = () => {
  const reduceMotion = useReducedMotion();

  const fadeUp: Variants = {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 16 },
    show: { opacity: 1, y: 0, transition: { duration: reduceMotion ? 0.01 : 0.5, ease: EASE } },
  };

  const stagger: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduceMotion ? 0 : 0.09 } },
  };

  const imageScaleIn: Variants = {
    hidden: { opacity: 0, scale: reduceMotion ? 1 : 1.04 },
    show: { opacity: 1, scale: 1, transition: { duration: reduceMotion ? 0.01 : 0.7, ease: EASE } },
  };

  const viewport = { once: true, margin: '-100px' } as const;

  return (
    <div className="home">
      <section
        className="home-hero"
        style={{
          backgroundImage:
            `linear-gradient(rgb(3 7 18 / 62%), rgb(3 7 18 / 62%)), ` +
            `url(${HERO_IMAGE})`,
        }}
        aria-labelledby="home-hero-heading"
      >
        <motion.div
          className="home-hero-content"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          <motion.h1 id="home-hero-heading" variants={fadeUp}>
            Track every parcel, from pickup to your door.
          </motion.h1>
          <motion.p variants={fadeUp}>
            Own fleet across the Kathmandu valley, KYC-verified riders, and delivery reach
            across Nepal. Enter a tracking ID below — no account needed.
          </motion.p>
          <motion.div variants={fadeUp} style={{ width: '100%' }}>
            <TrackSearchBox variant="hero" className="home-hero-search" />
          </motion.div>
        </motion.div>
      </section>

      <div className="home-trust-bar">
        <div className="home-trust-bar-inner">
          <span>Own fleet in the valley</span>
          <span>KYC-verified riders</span>
          <span>Live tracking, no login needed</span>
          <span>COD settlement dashboard</span>
        </div>
      </div>

      <section className="home-capabilities">
        <h2>What you get as a vendor partner</h2>

        <motion.div
          className="home-feature-row"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewport}
        >
          <motion.img
            className="home-feature-image"
            variants={imageScaleIn}
            src={STREET_IMAGE}
            alt="Motorbike traffic on a narrow street near Kathmandu's Durbar Square — the terrain our riders navigate on every delivery"
            loading="lazy"
            decoding="async"
          />
          <motion.div className="home-feature-text" variants={fadeUp}>
            <h3>Own fleet, tracked in real time</h3>
            <p>
              Our own riders carry your parcels across the Kathmandu valley. Every parcel
              gets a tracking ID the moment it's picked up, so you and your customer always
              know exactly where it is.
            </p>
          </motion.div>
        </motion.div>

        <motion.div
          className="home-feature-minor-grid"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewport}
        >
          <motion.div className="home-capability" variants={fadeUp}>
            <div className="home-capability-head">
              <Wallet size={20} />
              <h3>Collect COD, get settled on schedule</h3>
            </div>
            <p>Every cash-on-delivery parcel is logged against your account the moment it's collected. Check pending COD and settlement history any time from your vendor dashboard.</p>
          </motion.div>

          <motion.div className="home-capability" variants={fadeUp}>
            <div className="home-capability-head">
              <ShieldCheck size={20} />
              <h3>KYC-verified riders and staff</h3>
            </div>
            <p>Everyone who handles your parcels or your customers' cash is identity-verified before they're on the road.</p>
          </motion.div>

          <motion.div className="home-capability" variants={fadeUp}>
            <div className="home-capability-head">
              <Truck size={20} />
              <h3>Reach beyond the valley</h3>
            </div>
            <p>Delivery reach extends across the rest of Nepal, so you're not limited to Kathmandu customers.</p>
          </motion.div>
        </motion.div>
      </section>

      <section className="home-trust-explainer">
        <div className="home-trust-explainer-inner">
          <motion.div
            className="home-trust-explainer-copy"
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={viewport}
          >
            <h2>Trust you can check yourself</h2>
            <p>
              We'd rather you verify than take our word for it. Every parcel we carry gets a
              tracking ID at pickup — anyone can look up its status, no account required.
            </p>
            <TrackSearchBox variant="page" className="home-trust-explainer-search" />
          </motion.div>

          <motion.ul
            className="home-trust-explainer-list"
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={viewport}
          >
            <motion.li variants={fadeUp}>
              <Radio size={20} />
              <div>
                <h3>Status logged at every handoff</h3>
                <p>Pickup, dispatch, and delivery are each recorded the moment they happen — not batched and back-filled later.</p>
              </div>
            </motion.li>
            <motion.li variants={fadeUp}>
              <ClipboardCheck size={20} />
              <div>
                <h3>Every vendor application reviewed by a person</h3>
                <p>No automated approval or rejection. We check your business details ourselves and follow up directly.</p>
              </div>
            </motion.li>
            <motion.li variants={fadeUp}>
              <PackageSearch size={20} />
              <div>
                <h3>Your customers can track without asking you</h3>
                <p>Share the tracking ID and they can watch delivery progress themselves, straight from the receipt or SMS.</p>
              </div>
            </motion.li>
          </motion.ul>
        </div>
      </section>

      <section className="home-final-cta">
        <motion.div
          className="home-final-cta-inner"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewport}
        >
          <motion.div className="home-final-cta-copy" variants={fadeUp}>
            <h2>Your next delivery starts here.</h2>
            <p>Apply in about ten minutes, or track a parcel that's already on its way.</p>
          </motion.div>
          <motion.div className="home-final-cta-right" variants={fadeUp}>
            <div className="home-final-cta-actions">
              <Link to="/apply" className="btn home-final-cta-primary">
                Apply as a Vendor <ArrowRight size={18} />
              </Link>
              <Link to="/track" className="btn home-final-cta-secondary">
                Track a Parcel
              </Link>
            </div>
            <a href={PHONE_TEL} className="home-final-cta-phone">
              <Phone size={14} /> Prefer to talk? Call or WhatsApp {PHONE_DISPLAY}
            </a>
          </motion.div>
        </motion.div>
      </section>
    </div>
  );
};

export default Home;
