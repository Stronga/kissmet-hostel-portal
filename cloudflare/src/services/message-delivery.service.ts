export type MessageExternalChannel = "sms" | "email";

export interface MessageDeliveryInput {
  messageId: number;
  recipientSnapshotId: number;
  channel: MessageExternalChannel;
  subject: string;
  body: string;
}

export interface MessageDeliveryResult {
  status: "sent" | "delivered" | "failed";
  providerMessageId?: string;
  providerStatus?: string;
  failureReason?: string;
}

export interface MessageDeliveryProvider {
  send(input: MessageDeliveryInput): Promise<MessageDeliveryResult>;
}

export class MockMessageDeliveryProvider implements MessageDeliveryProvider {
  async send(input: MessageDeliveryInput): Promise<MessageDeliveryResult> {
    return {
      status: "sent",
      providerMessageId: `mock-${input.channel}-${input.messageId}-${input.recipientSnapshotId}`,
      providerStatus: "mock_sent"
    };
  }
}
