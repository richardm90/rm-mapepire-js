// Manual mock for @ibm/mapepire-js

export enum JobStatus {
  NOT_STARTED = "notStarted",
  CONNECTING = "connecting",
  READY = "ready",
  BUSY = "busy",
  ENDED = "ended"
}

export const States = {
  JobStatus
};

export class SQLJob {
  id: string;
  private status: string;

  constructor(options?: any) {
    this.id = 'mock-job-' + Math.random().toString(36).substr(2, 9);
    this.status = JobStatus.NOT_STARTED;
  }

  async connect(creds: any): Promise<void> {
    this.status = JobStatus.READY;
    return Promise.resolve();
  }

  async execute(sql: string, opts?: any): Promise<any> {
    return Promise.resolve({
      success: true,
      data: [],
      metadata: {},
    });
  }

  async close(): Promise<void> {
    this.status = JobStatus.ENDED;
    return Promise.resolve();
  }

  getStatus(): string {
    return this.status;
  }
}

export class Pool {
  static addJob(): any {
    return new SQLJob();
  }
}