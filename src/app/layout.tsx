import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Track Your Order',
  description: 'Track your order status in real time.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
