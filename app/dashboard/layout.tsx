export const dynamic = "force-dynamic"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</div>
}
