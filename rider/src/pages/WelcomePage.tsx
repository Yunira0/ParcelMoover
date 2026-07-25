import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'

export default function WelcomePage() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col flex-1 relative overflow-hidden bg-bg">

      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/welcome-bg.jpg)' }}
      />
      <div className="absolute inset-0 bg-black/50" />

      {/* Hero */}
      <div className="flex flex-col items-center flex-1 justify-center px-6 gap-5 relative z-10">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Rider App
          </h1>
          <p className="text-sm text-white/70">
            Sign in to manage your deliveries.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="px-5 pb-10 flex flex-col gap-3 relative z-10">
        <Button onClick={() => navigate('/login')}>
          Sign in to your account
        </Button>
        <p className="text-xs text-center text-white/50">
          Don't have an account? Contact your manager.
        </p>
      </div>
    </div>
  )
}
