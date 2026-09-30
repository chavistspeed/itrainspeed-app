import './globals.css'

export const metadata = {
  title: 'iTrainSpeed',
  description: 'Speed & Agility Training',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
