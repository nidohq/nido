#!/bin/sh
# One-time setup: registers the ESC/POS printer as a CUPS passthrough queue,
# so cupsPrinter.ts can print to it via `lp -o raw` instead of claiming the
# USB interface directly (see that file's doc comment for why raw USB access
# doesn't work reliably for this device on macOS).
#
# `lpadmin -m raw` (CUPS's usual raw-queue shortcut) is explicitly blocked on
# macOS ("Raw queues are no longer supported on macOS"), even though
# `lpinfo -m` still lists it — confirmed on this machine. The workaround:
# supply a minimal custom PPD whose only filter is a null passthrough
# (`cupsFilter2: application/octet-stream application/octet-stream 0 -`),
# which routes through CUPS's PPD-based path instead of the blocked
# model-shortcut path and achieves the same thing.
#
# Usage: ./scripts/setup-printer-queue.sh [queue-name]
# Default queue name: nido-receipt-printer (matches PRINTER_QUEUE_NAME's default)
set -e

QUEUE_NAME="${1:-nido-receipt-printer}"
PPD_PATH="$(mktemp -t nido-raw-XXXXXX).ppd"

echo "USB printer device URIs CUPS can see:"
echo
lpinfo -v | grep "^direct usb://" || {
  echo "  (none found — is the printer plugged in and powered on?)"
  exit 1
}
echo

DEVICE_URI=$(lpinfo -v | grep "^direct usb://" | head -1 | awk '{print $2}')
echo "Using: ${DEVICE_URI}"
echo "(edit this script or run \`lpinfo -v\` + \`lpadmin\` by hand if you want a different one)"
echo

cat > "${PPD_PATH}" <<'EOF'
*PPD-Adobe: "4.3"
*FormatVersion: "4.3"
*FileVersion: "1.0"
*LanguageEncoding: ISOLatin1
*LanguageVersion: English
*Manufacturer: "Generic"
*ModelName: "Raw Printer"
*ShortNickName: "Raw Printer"
*NickName: "Generic Raw Printer"
*PSVersion: "(1) 1"
*LanguageLevel: "1"
*ColorDevice: False
*DefaultColorSpace: Gray
*FileSystem: False
*Throughput: "1"
*cupsVersion: 2.0
*cupsManualCopies: True
*cupsModelNumber: 2
*cupsFilter2: "application/octet-stream application/octet-stream 0 -"
*OpenUI *PageSize: PickOne
*OrderDependency: 10 AnySetup *PageSize
*DefaultPageSize: Letter
*PageSize Letter/Letter: ""
*CloseUI: *PageSize
EOF

lpadmin -p "${QUEUE_NAME}" -E -v "${DEVICE_URI}" -P "${PPD_PATH}"
rm -f "${PPD_PATH}"

echo
echo "Registered CUPS queue \"${QUEUE_NAME}\" -> ${DEVICE_URI}"
lpstat -p "${QUEUE_NAME}"
echo
echo "Set PRINTER_DRIVER=cups and PRINTER_QUEUE_NAME=${QUEUE_NAME} (if not the default) to use it."
echo "To remove it later: lpadmin -x ${QUEUE_NAME}"
