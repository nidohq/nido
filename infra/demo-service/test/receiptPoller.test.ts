import { describe, expect, it } from "vitest";
import { pollReceiptsOnce } from "../src/receiptPoller.js";
import type { InvitePrintQueue, PendingPrintRecord } from "../src/inviteClient.js";
import type { Printer, PrintJob } from "../src/printer.js";

class FakeQueue implements InvitePrintQueue {
  acked: string[] = [];

  constructor(private queue: PendingPrintRecord[]) {}

  async nextPendingPrint(): Promise<PendingPrintRecord | undefined> {
    return this.queue.shift();
  }

  async ackPendingPrint(code: string): Promise<void> {
    this.acked.push(code);
  }
}

class FakePrinter implements Printer {
  jobs: PrintJob[] = [];

  async print(job: PrintJob): Promise<void> {
    this.jobs.push(job);
  }
}

describe("pollReceiptsOnce", () => {
  it("does nothing when the queue is empty", async () => {
    const queue = new FakeQueue([]);
    const printer = new FakePrinter();

    await pollReceiptsOnce(queue, printer);

    expect(printer.jobs).toEqual([]);
    expect(queue.acked).toEqual([]);
  });

  it("prints then acks a single pending receipt", async () => {
    const queue = new FakeQueue([{ code: "A", address: "CADDR" }]);
    const printer = new FakePrinter();

    await pollReceiptsOnce(queue, printer);

    expect(printer.jobs).toHaveLength(1);
    expect(printer.jobs[0]?.lines).toContain("Address: CADDR");
    expect(queue.acked).toEqual(["A"]);
  });

  it("drains the whole queue in one tick", async () => {
    const queue = new FakeQueue([{ code: "A" }, { code: "B" }, { code: "C" }]);
    const printer = new FakePrinter();

    await pollReceiptsOnce(queue, printer);

    expect(printer.jobs).toHaveLength(3);
    expect(queue.acked).toEqual(["A", "B", "C"]);
  });
});
