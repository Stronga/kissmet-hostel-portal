export interface SmsProvider {
  sendOtp(destination: string, otp: string): Promise<void>;
}

export class MockSmsProvider implements SmsProvider {
  public lastMessage: { destination: string; otp: string } | null = null;

  async sendOtp(destination: string, otp: string): Promise<void> {
    this.lastMessage = { destination, otp };
  }
}
