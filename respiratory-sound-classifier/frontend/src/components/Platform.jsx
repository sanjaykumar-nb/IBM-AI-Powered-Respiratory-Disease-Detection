// The IBM Z / LinuxONE machine the model runs on, as reported live by the ML service (/proc on the server).

const STATUS = {
  used: { label: 'In use', tone: 'ok' },
  available: { label: 'Available', tone: 'neutral' },
  absent: { label: 'Not on this machine', tone: 'muted' },
};

function technologies(z) {
  const has = (f) => z.features?.includes(f);
  const vector = ['vxe2', 'vxe', 'vx'].find(has);
  return [
    {
      name: 'Vector facility (SIMD)',
      status: z.numpy_simd?.length ? 'used' : vector ? 'available' : 'absent',
      body: z.numpy_simd?.length
        ? `Audio feature extraction runs NumPy's IBM Z vector kernels (${z.numpy_simd.join(', ')}) on every recording.`
        : 'Vector instructions that process many audio samples per instruction.',
    },
    {
      name: 'On-chip AI accelerator (Telum)',
      status: has('nnpa') ? 'available' : 'absent',
      body: has('nnpa')
        ? 'Every processor chip has an AI accelerator (NNPA). The model can be compiled for it with the IBM Z Deep Learning Compiler.'
        : 'Arrived with IBM z16 / LinuxONE 4: an AI accelerator on every processor chip.',
    },
    {
      name: 'CPACF crypto',
      status: has('msa') ? 'available' : 'absent',
      body: 'AES and SHA in hardware on every core. OpenSSL uses it automatically whenever it encrypts or hashes, e.g. for HTTPS.',
    },
    {
      name: 'On-chip compression',
      status: has('dflt') ? 'available' : 'absent',
      body: has('dflt')
        ? 'DEFLATE (gzip / zlib) in hardware, used transparently by the system zlib.'
        : 'Arrived with IBM z15 / LinuxONE III: gzip-compatible compression in hardware.',
    },
  ];
}

export default function Platform({ server }) {
  const z = server.ibmZ;
  if (server.state !== 'online') return null;

  if (!z) {
    return (
      <section id="platform" className="platform">
        <div className="page">
          <p className="eyebrow">Platform</p>
          <p className="platform__note">
            This server is {server.arch || 'not IBM Z'}. Deployed on IBM LinuxONE, this section shows the machine and the
            on-chip accelerators the model can use.
          </p>
        </div>
      </section>
    );
  }

  const facts = [
    ['Machine', z.machine_name],
    ['Machine type', z.machine_type],
    ['Virtualisation', z.hypervisor],
    ['Processors', z.cpus && `${z.cpus} CPU${z.cpus === 1 ? '' : 's'}${z.cpu_mhz ? ` at ${(z.cpu_mhz / 1000).toFixed(1)} GHz` : ''}`],
    ['Architecture', 's390x (z/Architecture, big-endian)'],
  ].filter(([, v]) => v);

  return (
    <section id="platform" className="platform">
      <div className="page">
        <p className="eyebrow">Platform</p>
        <h2 className="method__title">Running on IBM Z</h2>

        <dl className="details platform__facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd title={v}>{v}</dd>
            </div>
          ))}
        </dl>

        <ul className="tech">
          {technologies(z).map((t) => (
            <li key={t.name} className={`tech__item tech__item--${t.status}`}>
              <div className="tech__head">
                <h3>{t.name}</h3>
                <span className={`badge badge--${STATUS[t.status].tone}`}>{STATUS[t.status].label}</span>
              </div>
              <p>{t.body}</p>
            </li>
          ))}
        </ul>
        <p className="platform__note">Read live from /proc/cpuinfo and /proc/sysinfo on the inference server.</p>
      </div>
    </section>
  );
}
