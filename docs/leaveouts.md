# Leave-outs (exeat) and the gate

A boarder leaves school only on an approved leave-out, through the gate, with a person the
parents trust. Parents get an SMS when the child leaves and when they are back.

## The flow

1. **Request.** A class teacher, the boarding master, the matron (anyone with "request
   leave-outs"), or a parent in the portal, records the student, reason, leave and return times,
   and who is collecting.
   - The collector is a guardian the school marked **authorised to collect**, or **someone else**.
     For someone else, the parents get an SMS naming them ("Reply YES 1234"), or approve in the
     portal. Only then can it be approved. A parent who names someone else in their own request
     has approved them already.
2. **Approve or decline.** Only staff the Director has granted **approve leave-outs** (Staff →
   person → leave-out approval). The approver's queue is on their phone under **Leave-outs**. A
   decline needs a reason; the requester and the parents are told either way.
3. **The pass.** On approval Kiota issues the gate pass and texts the collector a **4-digit pickup
   code** (critical SMS). Print it on A5 (Leave-outs → the request → Print the gate pass); the
   parent can also show it from the portal (Leave-outs → Show the gate pass). Cancelling it makes
   the pass stop working at once.
4. **The gate.** The guard scans the QR code, checks the photo and the collector, enters the
   pickup code and taps **Mark exit**. The parents get "Brian left Bahari Academy at 14:05 with
   Wanjiku Kamau." On return, the same pass offers **Mark return** and the parents get "Brian is
   back at school, 17:40." One exit and one return per pass; reuse is refused.
5. **Late back.** A student not back by the return time raises an alert to the boarding master
   and the Director, and the parents get an SMS reminder, once.

The Director sees who approved every leave-out (the request's "Who did what"), who is out now
(Leave-outs → Out now) and reports per class and reason, late returns and approvers.

## The pass and its QR code

The QR code holds only a signed token: `KP1.<school>.<leave-out>.<random>.<signature>`. No name,
class or photo is in it. The signature is Ed25519, made with the school's private key (encrypted
at rest with `CREDENTIALS_ENCRYPTION_KEY`, never sent anywhere). Gate phones get only the public
key, so they can check a pass offline but cannot make one. A pass from another school fails.

## The gate screen (/gate)

Made for a guard's phone in the sun: large text, a full-width green **VALID** or red **NOT VALID**
with the reason (expired, cancelled, already used, wrong time, not found), the student's photo,
name, class, collector and window.

- **Scan pass** uses the phone camera (the browser's own QR reader where it has one, otherwise
  a small reader that loads when the gate opens).
- **Use a photo of the pass** takes a picture with the camera app instead; it works everywhere,
  even without camera permission.
- **Search by name** for a damaged QR code.
- **Half-term mode**: after each exit the camera opens again for the next student.
- **Offline**: the phone keeps today's and tomorrow's passes (with photos) and the public key,
  checks passes and pickup codes itself, and keeps exits and returns until it is online. If the
  school cancelled a pass meanwhile, the exit is still recorded (the child did leave), flagged,
  and the boarding master is told.

A gate guard sees only the gate: never student records, fees, marks or medical notes. The gate
reads a copy of the name, class, admission number and photo made when the leave-out is
requested.

## Half term

Leave-outs → Half term: one approved pass for every student in a class, level or all boarders,
collected by their first guardian marked authorised to collect. Each collector gets a pickup
code. Students with no such guardian are listed and skipped.

## Trying the gate scanner on a phone over Wi-Fi

Phone cameras only open for https sites or `localhost`. Over the local Wi-Fi the app is plain
http, so pick one:

1. **Simplest, no setup: use a photo.** Run `npm run dev:phone`, open the address it prints,
   sign in as the gate guard **0711 000 004**, and tap **Use a photo of the pass**. The camera
   app opens, you take a picture of the printed pass (or of the pass on another screen), and the
   gate reads it. Everything else (VALID, the code, exit, return) is the same.
2. **Live camera scanning: one Chrome setting on the phone.** In Chrome on the phone open
   `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add the address `npm run dev:phone`
   printed (e.g. `http://192.168.100.35:3000`), set it to Enabled and restart Chrome. **Scan
   pass** then opens the camera. Remove the address again when you are done.
3. **Real https**: a Cloudflare quick tunnel (as in docs/mpesa.md) gives an https address; run
   the dev server with `APP_URL` set to it.

The pickup code for each seeded pass is in `.dev/sms-outbox.log` ("Your pickup code for ...").
To try a whole journey: sign in as Wanjiku (0744 000 001) and request a leave-out for Brian,
approve it as Mercy (0711 000 005), print the pass, then scan it as Hassan (0711 000 004).

Offline mode needs the service worker, which runs only on https (or app.localhost): on plain
http over Wi-Fi the gate works but not offline.

To answer a "someone else is collecting" SMS without a phone:
`npm run sms:simulate -- reply --from 0744000001 --text "YES 1234"`.
