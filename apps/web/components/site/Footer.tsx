import Link from "next/link";

const COLS: [string, [string, string][]][] = [
  ["Product/", [["How it works", "/how-it-works"], ["Console", "/console"], ["Verify", "/verify"], ["Policies", "/policies"]]],
  ["Network/", [["Status", "/status"], ["Ledger", "/ledger"], ["Telegraph", "https://docs.telegraphprotocol.com"]]],
  ["Build/", [["Integrate", "/docs"], ["API reference", "/docs#endpoints"], ["Source", "https://github.com/linoxbt/skein"]]],
  ["Hackathon/", [["Telegraph S2", "https://hackathon.telegraphprotocol.com"], ["Mission 01: Exchange", "https://hackathon.telegraphprotocol.com/missions/exchange"], ["Mission 14: DeFi", "https://hackathon.telegraphprotocol.com/missions/web3-defi"]]],
];

export function Footer() {
  return (
    <footer className="bg-bg">
      <div className="mx-auto max-w-[1400px] px-5 pb-10 pt-24 md:px-10">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          {COLS.map(([title, links]) => (
            <div key={title}>
              <h3 className="mb-5 font-mono text-[13px] text-muted">{title}</h3>
              <ul className="space-y-3">
                {links.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith("http") ? (
                      <a href={href} className="text-[15px] hover:text-thread" target="_blank" rel="noreferrer">{label}</a>
                    ) : (
                      <Link href={href} className="text-[15px] hover:text-thread">{label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-24 select-none font-brand text-[22vw] font-medium lowercase leading-[0.8] tracking-[-0.06em] text-panel-2 md:text-[18vw]" aria-hidden>
          skein
        </div>
        <div className="mt-8 flex flex-col justify-between gap-3 border-t border-edge pt-6 text-[13px] text-muted md:flex-row">
          <span>Risk evidence, not investment advice. Payments and registration on the Telegraph testnet.</span>
          <span className="font-mono">One request. Every thread.</span>
        </div>
      </div>
    </footer>
  );
}
