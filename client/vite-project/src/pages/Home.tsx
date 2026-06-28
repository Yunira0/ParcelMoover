import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle } from 'lucide-react';
import Button from '../components/Button';
import './Home.css';

const Home: React.FC = () => {
  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-content">
          <span className="home-badge">Nepal's Delivery Network</span>
          <h1>Become a<br />Vendor Partner</h1>
          <p>Register your business and start delivering to customers across Nepal. Quick onboarding, competitive rates, and reliable support.</p>
          
          <div className="home-benefits">
            <div className="home-benefit">
              <CheckCircle size={18} />
              <span>24h Onboarding</span>
            </div>
            <div className="home-benefit">
              <CheckCircle size={18} />
              <span>50+ Districts</span>
            </div>
            <div className="home-benefit">
              <CheckCircle size={18} />
              <span>Real-time Tracking</span>
            </div>
          </div>

          <Link to="/apply" className="home-cta-button btn btn-primary">
            Register Now <ArrowRight size={18} />
          </Link>
        </div>

        <div className="home-hero-visual">
          <div className="home-stat-card">
            <span className="home-stat-number">10,000+</span>
            <span className="home-stat-label">Parcels Delivered</span>
          </div>
          <div className="home-stat-card">
            <span className="home-stat-number">50+</span>
            <span className="home-stat-label">Districts Covered</span>
          </div>
          <div className="home-stat-card">
            <span className="home-stat-number">24h</span>
            <span className="home-stat-label">Quick Onboarding</span>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
