import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Wallet, ShieldCheck, Truck, Phone, PackageSearch, ClipboardCheck, Radio } from 'lucide-react';
import TrackSearchBox from '../components/TrackSearchBox';
import { PHONE_DISPLAY, PHONE_TEL } from '../constants/contact';
import './Home.css';

const HERO_IMAGE = 'https://images.unsplash.com/photo-1781276532606-12957bd9a930';
const STREET_IMAGE = 'https://images.unsplash.com/photo-1781637773536-5188b1f1f569';
const imageUrl = (photo: string, width: number) =>
  `${photo}?auto=format&fit=crop&w=${width}&q=75`;
const imageSrcSet = (photo: string, widths: number[]) =>
  widths.map((width) => `${imageUrl(photo, width)} ${width}w`).join(', ');

const Home: React.FC = () => {
  return (
    <div className="home">
      <section
        className="home-hero"
        aria-labelledby="home-hero-heading"
      >
        <img
          className="home-hero-image"
          src={imageUrl(HERO_IMAGE, 1440)}
          srcSet={imageSrcSet(HERO_IMAGE, [640, 960, 1440, 1920])}
          sizes="(max-width: 1440px) 90vw, 1280px"
          alt=""
          fetchPriority="high"
          decoding="async"
        />
        <div className="home-hero-content">
          <h1 id="home-hero-heading">
            Track every parcel, from pickup to your door.
          </h1>
          <p>
            Own fleet across the Kathmandu valley, KYC-verified riders, and delivery reach
            across Nepal. Enter a tracking ID below — no account needed.
          </p>
          <div style={{ width: '100%' }}>
            <TrackSearchBox variant="hero" className="home-hero-search" />
          </div>
        </div>
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

        <div className="home-feature-row">
          <img
            className="home-feature-image"
            src={imageUrl(STREET_IMAGE, 960)}
            srcSet={imageSrcSet(STREET_IMAGE, [480, 720, 960, 1200])}
            sizes="(max-width: 760px) 88vw, 50vw"
            alt="Motorbike traffic on a narrow street near Kathmandu's Durbar Square — the terrain our riders navigate on every delivery"
            loading="lazy"
            decoding="async"
          />
          <div className="home-feature-text">
            <h3>Own fleet, tracked in real time</h3>
            <p>
              Our own riders carry your parcels across the Kathmandu valley. Every parcel
              gets a tracking ID the moment it's picked up, so you and your customer always
              know exactly where it is.
            </p>
          </div>
        </div>

        <div className="home-feature-minor-grid">
          <div className="home-capability">
            <div className="home-capability-head">
              <Wallet size={20} />
              <h3>Collect COD, get settled on schedule</h3>
            </div>
            <p>Every cash-on-delivery parcel is logged against your account the moment it's collected. Check pending COD and settlement history any time from your vendor dashboard.</p>
          </div>

          <div className="home-capability">
            <div className="home-capability-head">
              <ShieldCheck size={20} />
              <h3>KYC-verified riders and staff</h3>
            </div>
            <p>Everyone who handles your parcels or your customers' cash is identity-verified before they're on the road.</p>
          </div>

          <div className="home-capability">
            <div className="home-capability-head">
              <Truck size={20} />
              <h3>Reach beyond the valley</h3>
            </div>
            <p>Delivery reach extends across the rest of Nepal, so you're not limited to Kathmandu customers.</p>
          </div>
        </div>
      </section>

      <section className="home-trust-explainer">
        <div className="home-trust-explainer-inner">
          <div className="home-trust-explainer-copy">
            <h2>Trust you can check yourself</h2>
            <p>
              We'd rather you verify than take our word for it. Every parcel we carry gets a
              tracking ID at pickup — anyone can look up its status, no account required.
            </p>
            <TrackSearchBox variant="page" className="home-trust-explainer-search" />
          </div>

          <ul
            className="home-trust-explainer-list"
          >
            <li>
              <Radio size={20} />
              <div>
                <h3>Status logged at every handoff</h3>
                <p>Pickup, dispatch, and delivery are each recorded the moment they happen — not batched and back-filled later.</p>
              </div>
            </li>
            <li>
              <ClipboardCheck size={20} />
              <div>
                <h3>Every vendor application reviewed by a person</h3>
                <p>No automated approval or rejection. We check your business details ourselves and follow up directly.</p>
              </div>
            </li>
            <li>
              <PackageSearch size={20} />
              <div>
                <h3>Your customers can track without asking you</h3>
                <p>Share the tracking ID and they can watch delivery progress themselves, straight from the receipt or SMS.</p>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section className="home-final-cta">
        <div className="home-final-cta-inner">
          <div className="home-final-cta-copy">
            <h2>Your next delivery starts here.</h2>
            <p>Apply in about ten minutes, or track a parcel that's already on its way.</p>
          </div>
          <div className="home-final-cta-right">
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
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
