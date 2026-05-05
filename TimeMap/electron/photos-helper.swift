import Foundation
import Photos
import AppKit

// ---- Encodable types --------------------------------------------------------

struct AlbumInfo: Encodable {
    let id:    String
    let name:  String
    let count: Int
}

struct PhotoRecord: Encodable {
    let uuid:         String
    let lat:          Double?
    let lng:          Double?
    let takenAt:      String?
    let filePath:     String?
    let width:        Int
    let height:       Int
    let thumbWritten: Bool
    let error:        String?
}

// ---- Helpers ----------------------------------------------------------------

let enc = JSONEncoder()

func toJSON<T: Encodable>(_ v: T) -> String {
    guard let data = try? enc.encode(v),
          let str  = String(data: data, encoding: .utf8) else { return "{}" }
    return str
}

let isoFmt: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

// ---- Authorization ----------------------------------------------------------

func requestAuth() -> Bool {
    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    if status == .authorized || status == .limited { return true }
    if status == .denied    || status == .restricted { return false }
    let sem = DispatchSemaphore(value: 0)
    var ok  = false
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { s in
        ok = s == .authorized || s == .limited
        sem.signal()
    }
    sem.wait()
    return ok
}

// ---- list-albums ------------------------------------------------------------

func cmdListAlbums() {
    let allCount = PHAsset.fetchAssets(with: .image, options: nil).count
    var albums: [AlbumInfo] = [AlbumInfo(id: "__all__", name: "All Photos", count: allCount)]

    let cols = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
    cols.enumerateObjects { col, _, _ in
        let n = PHAsset.fetchAssets(in: col, options: nil).count
        if n > 0 {
            albums.append(AlbumInfo(
                id:    col.localIdentifier,
                name:  col.localizedTitle ?? "Untitled",
                count: n
            ))
        }
    }

    print(toJSON(albums))
    fflush(stdout)
    exit(0)
}

// ---- import-photos ----------------------------------------------------------

func cmdImport(thumbsDir: String, albumId: String?) {
    let fm = FileManager.default
    try? fm.createDirectory(atPath: thumbsDir, withIntermediateDirectories: true, attributes: nil)

    // Fetch assets
    let assets: PHFetchResult<PHAsset>
    if let albumId = albumId, albumId != "__all__" {
        let opts = PHFetchOptions()
        opts.predicate = NSPredicate(format: "localIdentifier == %@", albumId)
        let cols = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: opts)
        guard let col = cols.firstObject else {
            fputs("album-not-found\n", stderr)
            exit(2)
        }
        assets = PHAsset.fetchAssets(in: col, options: nil)
    } else {
        assets = PHAsset.fetchAssets(with: .image, options: nil)
    }

    // First line tells the backend how many records to expect
    print("TOTAL \(assets.count)")
    fflush(stdout)

    let mgr = PHImageManager.default()

    let thumbOpts = PHImageRequestOptions()
    thumbOpts.deliveryMode        = .highQualityFormat
    thumbOpts.isSynchronous       = true
    thumbOpts.isNetworkAccessAllowed = true

    let editOpts = PHContentEditingInputRequestOptions()
    editOpts.canHandleAdjustmentData = { _ in true }
    editOpts.isNetworkAccessAllowed  = false  // skip iCloud-only originals

    let thumbSize = CGSize(width: 400, height: 400)

    assets.enumerateObjects { asset, _, _ in
        // Strip the "/L0/001" suffix from Photos localIdentifier to get a plain UUID
        let uuid = asset.localIdentifier
            .components(separatedBy: "/").first ?? asset.localIdentifier

        let lat    = asset.location?.coordinate.latitude
        let lng    = asset.location?.coordinate.longitude
        let takenAt = asset.creationDate.map { isoFmt.string(from: $0) }

        // Write thumbnail (skip if already present from a previous import run)
        let thumbPath = (thumbsDir as NSString).appendingPathComponent("\(uuid).jpg")
        var thumbWritten = false

        if fm.fileExists(atPath: thumbPath) {
            thumbWritten = true
        } else {
            mgr.requestImage(
                for: asset,
                targetSize: thumbSize,
                contentMode: .aspectFit,
                options: thumbOpts
            ) { img, _ in
                guard let img  = img,
                      let tiff = img.tiffRepresentation,
                      let rep  = NSBitmapImageRep(data: tiff),
                      let jpg  = rep.representation(
                            using: .jpeg,
                            properties: [.compressionFactor: NSNumber(value: 0.82)]
                      )
                else { return }
                try? jpg.write(to: URL(fileURLWithPath: thumbPath))
                thumbWritten = true
            }
        }

        // Resolve the original file path (local photos only; iCloud returns nil)
        var filePath: String? = nil
        let sem = DispatchSemaphore(value: 0)
        let reqId = asset.requestContentEditingInput(with: editOpts) { input, _ in
            filePath = input?.fullSizeImageURL?.path
            sem.signal()
        }
        // 5-second timeout so iCloud-unavailable photos don't stall the import
        if sem.wait(timeout: .now() + 5) == .timedOut {
            asset.cancelContentEditingInputRequest(reqId)
        }

        let rec = PhotoRecord(
            uuid:         uuid,
            lat:          lat,
            lng:          lng,
            takenAt:      takenAt,
            filePath:     filePath,
            width:        asset.pixelWidth,
            height:       asset.pixelHeight,
            thumbWritten: thumbWritten,
            error:        nil
        )
        print(toJSON(rec))
        fflush(stdout)
    }

    exit(0)
}

// ---- Entry point ------------------------------------------------------------

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("Usage: photos-helper <list-albums|import-photos> [args]\n", stderr)
    exit(3)
}

// All PhotoKit work runs on a background thread; the main thread runs a run
// loop so that authorization dialogs and async callbacks can be delivered.
DispatchQueue.global(qos: .userInitiated).async {
    guard requestAuth() else {
        fputs("permission-denied\n", stderr)
        exit(1)
    }

    switch args[1] {
    case "list-albums":
        cmdListAlbums()

    case "import-photos":
        guard args.count >= 3 else {
            fputs("Usage: photos-helper import-photos <thumbsDir> [albumId]\n", stderr)
            exit(3)
        }
        let albumId: String? = args.count >= 4 ? args[3] : nil
        cmdImport(thumbsDir: args[2], albumId: albumId)

    default:
        fputs("Unknown command: \(args[1])\n", stderr)
        exit(3)
    }
}

RunLoop.main.run()
