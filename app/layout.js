export const metadata = { title: "Email Digest Agent" };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fff" }}>{children}</body>
    </html>
  );
}
