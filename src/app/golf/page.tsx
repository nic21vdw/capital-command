import { AppShell } from '@/components/layout/app-shell'
import { GolfSwingPage } from '@/components/golf/golf-swing-page'

export const metadata = {
  title: 'Swing Analyzer | Nic Vandewetering',
  description: 'AI-powered golf swing analysis using pose detection.',
}

export default function GolfPage() {
  return (
    <AppShell>
      <GolfSwingPage />
    </AppShell>
  )
}
