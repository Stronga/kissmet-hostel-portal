import type { ReactNode } from "react";
import { Modal } from "../../design-system/react/Modal";

export function ConfirmDialog({
  open,
  title,
  description,
  children,
  onClose
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} description={description} onClose={onClose} showCloseButton={false}>
      {children}
    </Modal>
  );
}
