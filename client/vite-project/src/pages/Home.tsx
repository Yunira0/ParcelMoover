import React from 'react';
import { Link } from 'react-router-dom';

const Home: React.FC = () => {
  return (
    <div className="home-page">
      <h1>hello parcelmoover</h1>
      <Link to="/login" className="login-link">Go to Login</Link>
    </div>
  );
};

export default Home;
