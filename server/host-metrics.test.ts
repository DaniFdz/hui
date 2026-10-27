import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  createHostMetrics,
  metricsBetween,
  parseIoregGpu,
  parseMeminfoSwap,
  parseNetstat,
  parseNvidiaSmi,
  parseProcNetDev,
  parseSwapUsage,
  parseVmStat,
  type RawSample,
} from "./host-metrics.ts";

const NETSTAT = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                      28358242     0 66692630524 28358242     0 66692630524     0
lo0        16384 127           localhost       28358242     - 66692630524 28358242     - 66692630524     -
gif0*      1280  <Link#2>                             0     0          0        0     0          0     0
en0        1500  <Link#11>   aa:bb:cc:dd:ee:ff   900000     0  1000000000   500000     0   200000000     0
en0        1500  fe80::1c2:3 fe80:b::1c2:3       900000     -  1000000000   500000     -   200000000     -
utun3      1380  <Link#19>                           10     0       5000       20     0        7000     0
bridge0    1500  <Link#20>   aa:bb:cc:dd:ee:00       10     0       5000       20     0        7000     0
en1        1500  <Link#12>   aa:bb:cc:dd:ee:01       10     0       5000       20     0        7000     0
`;

const PROC_NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 9999999   100    0    0    0     0          0         0  9999999   100    0    0    0     0       0          0
  eth0: 4000000  3000    0    0    0     0          0         0  1500000  2000    0    0    0     0       0          0
 wlan0:    1000    10    0    0    0     0          0         0      500     5    0    0    0     0       0          0
docker0:   8000    10    0    0    0     0          0         0     8000     5    0    0    0     0       0          0
vethab12:  8000    10    0    0    0     0          0         0     8000     5    0    0    0     0       0          0
`;

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     3792.
Pages active:                                1000000.
Pages inactive:                              1365624.
Pages speculative:                             40716.
Pages wired down:                             400000.
Pages purgeable:                               73675.
Pages occupied by compressor:                 100000.
`;

test("netstat sums each physical interface's link row once, leaving loopback, tunnels and bridges out", () => {
  assert.deepEqual(parseNetstat(NETSTAT), { rx: 1_000_005_000, tx: 200_007_000 });
  assert.equal(parseNetstat("Name Mtu Network Address\n"), null);
});

test("/proc/net/dev sums receive and transmit bytes, leaving loopback and container interfaces out", () => {
  assert.deepEqual(parseProcNetDev(PROC_NET_DEV), { rx: 4_001_000, tx: 1_500_500 });
  assert.equal(parseProcNetDev("Inter-| Receive\n"), null);
});

test("vm_stat counts active, wired and compressed pages as used", () => {
  assert.equal(parseVmStat(VM_STAT), 1_500_000 * 16384);
  assert.equal(parseVmStat("Pages active: 3."), null);
});

test("swap use reads from sysctl on macOS and /proc/meminfo on Linux", () => {
  assert.equal(parseSwapUsage("vm.swapusage: total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)"), 1024.5 * 1024 ** 2);
  assert.equal(parseSwapUsage("vm.swapusage: total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)"), 0);
  assert.equal(parseMeminfoSwap("MemTotal: 100 kB\nSwapTotal:     2048 kB\nSwapFree:       512 kB\n"), 1536 * 1024);
  assert.equal(parseMeminfoSwap("MemTotal: 100 kB\n"), null);
});

test("the busiest GPU's utilization is reported", () => {
  const ioreg = `+-o AGXAcceleratorG14X  <class AGXAcceleratorG14X>
    "PerformanceStatistics" = {"In use system memory"=123,"Device Utilization %"=18,"Renderer Utilization %"=12}
    "PerformanceStatistics" = {"Device Utilization %"=42}`;
  assert.equal(parseIoregGpu(ioreg), 42);
  assert.equal(parseIoregGpu("no accelerator"), null);
  assert.equal(parseNvidiaSmi("12\n87\n"), 87);
  assert.equal(parseNvidiaSmi(""), null);
});

function raw(at: number, overrides: Partial<RawSample> = {}): RawSample {
  return {
    at,
    cpu: { idle: 0, total: 0 },
    load: [1.234, 2, 3],
    cores: 8,
    memory: { totalBytes: 100, usedBytes: 40 },
    disk: { path: "/config", totalBytes: 1000, usedBytes: 900 },
    network: { rx: 0, tx: 0 },
    gpuPercent: null,
    process: { cpuMicros: 0, rssBytes: 50 },
    ...overrides,
  };
}

test("percentages and rates are deltas against the previous sample", () => {
  const metrics = metricsBetween(
    raw(1_000),
    raw(3_000, { cpu: { idle: 750, total: 1000 }, network: { rx: 4_000, tx: 1_000 }, process: { cpuMicros: 500_000, rssBytes: 60 }, gpuPercent: 30 }),
    "darwin",
  );
  assert.equal(metrics.cpu.percent, 25);
  assert.deepEqual(metrics.cpu.load, [1.2, 2, 3]);
  assert.deepEqual(metrics.network, { rxBytesPerSecond: 2_000, txBytesPerSecond: 500 });
  assert.deepEqual(metrics.gpu, { percent: 30 });
  assert.deepEqual(metrics.gateway, { cpuPercent: 25, rssBytes: 60 });
  assert.equal(metrics.sampledAt, new Date(3_000).toISOString());
  const reset = metricsBetween(raw(0, { network: { rx: 10, tx: 10 } }), raw(1_000, { network: null }), "linux");
  assert.equal(reset.network, null, "a host without counters has no network rate");
  assert.equal(metricsBetween(raw(0, { network: { rx: 10, tx: 10 } }), raw(1_000), "linux").network?.rxBytesPerSecond, 0, "a reset counter never reads negative");
});

test("one sample serves every caller for two seconds, and a read in flight is shared", async () => {
  vi.useFakeTimers();
  try {
    let reads = 0;
    const hostMetrics = createHostMetrics(async () => raw(Date.now(), { cpu: { idle: ++reads * 50, total: reads * 100 } }), "darwin");
    const first = hostMetrics();
    const concurrent = hostMetrics();
    await vi.advanceTimersByTimeAsync(250);
    assert.equal(await first, await concurrent);
    assert.equal(reads, 2, "the first read takes a baseline and a sample");
    assert.equal((await first).cpu.percent, 50);
    await vi.advanceTimersByTimeAsync(1_000);
    await hostMetrics();
    assert.equal(reads, 2, "a read within two seconds reuses the last sample");
    await vi.advanceTimersByTimeAsync(1_500);
    await hostMetrics();
    assert.equal(reads, 3, "a later read takes one sample against the last");
    await vi.advanceTimersByTimeAsync(60_000);
    const late = hostMetrics();
    await vi.advanceTimersByTimeAsync(250);
    await late;
    assert.equal(reads, 5, "after a long pause the read takes a fresh baseline");
  } finally {
    vi.useRealTimers();
  }
});
