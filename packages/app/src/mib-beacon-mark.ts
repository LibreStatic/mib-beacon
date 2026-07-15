/**
 * Runtime copy of the canonical package mark in assets/brand/mib-beacon.svg.
 * tests/release-identity.test.ts keeps both representations byte-for-byte aligned.
 */
export const MIB_BEACON_MARK_SVG = String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">MIB Beacon mark</title>
  <desc id="desc">A network node emitting three beacon arcs above an OID tree stem.</desc>
  <rect width="512" height="512" rx="112" fill="#0b0e13"/>
  <path d="M116 218a198 198 0 0 1 280 0" fill="none" stroke="#72a7ff" stroke-width="34" stroke-linecap="round"/>
  <path d="M166 270a128 128 0 0 1 180 0" fill="none" stroke="#5ee0ae" stroke-width="34" stroke-linecap="round"/>
  <path d="M214 320a60 60 0 0 1 84 0" fill="none" stroke="#ffd166" stroke-width="34" stroke-linecap="round"/>
  <circle cx="256" cy="366" r="34" fill="#e8ecf3"/>
  <path d="M256 400v42m0-20h-74m74 0h74" fill="none" stroke="#e8ecf3" stroke-width="22" stroke-linecap="round"/>
  <circle cx="182" cy="442" r="18" fill="#72a7ff"/>
  <circle cx="330" cy="442" r="18" fill="#5ee0ae"/>
</svg>`;
