export type ExternalAnnouncementChannel = "sms" | "email";

export interface AnnouncementDeliveryInput {
  announcementId: number;
  channel: ExternalAnnouncementChannel;
  recipientUserId: number;
  recipientKind: "resident" | "staff";
  title: string;
  body: string;
}

export interface AnnouncementDeliveryResult {
  status: "sent" | "failed";
  providerMessageId?: string;
  providerStatus?: string;
  failureReason?: string;
}

export interface AnnouncementDeliveryProvider {
  send(input: AnnouncementDeliveryInput): Promise<AnnouncementDeliveryResult>;
}

export class MockAnnouncementDeliveryProvider implements AnnouncementDeliveryProvider {
  async send(input: AnnouncementDeliveryInput): Promise<AnnouncementDeliveryResult> {
    return {
      status: "sent",
      providerMessageId: `mock-${input.channel}-${input.announcementId}-${input.recipientUserId}`,
      providerStatus: "mock_sent"
    };
  }
}
