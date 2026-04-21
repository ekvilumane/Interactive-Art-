const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

AFRAME.registerComponent("go-to", {
    schema: {
        position: { type: "vec3" },
        rotation: { type: "vec3", default: { x: 0, y: 0, z: 0 } },
        duration: { type: "number", default: 2000 },
        easing: { type: "string", default: "easeInOutQuad" },
        fogChange: { type: "boolean", default: false },
        fogColor: { type: "string", default: "#ffffff" },
        startFogOn: { type: "string", default: "start" },
        fogDuration: { type: "number", default: 1000 },
        fogDensity: { type: "number", default: 0.1 },
        fogDirection: { type: "string", default: "in" },
    },

    init() {
        this.cameraEl =
            this.el.sceneEl.querySelector("[camera]") ||
            this.el.sceneEl.querySelector("a-camera");
        this.tunnelEl = null;
        this.isVR = false;
        this.animating = false;
        this.useVROffset = false;

        this.locationSpecified = true;

        console.log(this.data);

        // if no position specified, use the elements current position as target
        if (
            !this.data.position ||
            (this.data.position.x === 0 &&
                this.data.position.y === 0 &&
                this.data.position.z === 0)
        ) {
            this.data.position = this.el.object3D.position.clone();
            this.locationSpecified = false;
        }

        // Pre-allocated objects
        this._startPos = new THREE.Vector3();
        this._endPos = new THREE.Vector3();
        this._startQuat = new THREE.Quaternion();
        this._endQuat = new THREE.Quaternion();
        this._headOffset = new THREE.Vector3();
        this._tempVec = new THREE.Vector3();
        this._vrDelta = null;
        this._vrApplied = null;

        this.el.sceneEl.addEventListener("enter-vr", () => (this.isVR = true));
        this.el.sceneEl.addEventListener("exit-vr", () => (this.isVR = false));

        this._onClick = this._onClick.bind(this);
        this.el.addEventListener("click", this._onClick);
    },

    _onClick(evt) {
        if (!evt.detail?.intersection) return;

        this.tunnelEl =
            this.tunnelEl || this.el.sceneEl.querySelector("#tunnel");
        if (this.tunnelEl) {
            this.tunnelEl.removeAttribute("animation__down");
            this.tunnelEl.setAttribute("animation__down", {
                property: "scale.y",
                to: -1,
                dur: 500,
                easing: this.data.easing,
            });
        }

        const { position, rotation } = this.data;
        const hasRotation =
            Math.abs(rotation.x) + Math.abs(rotation.y) + Math.abs(rotation.z) >
            0.001;

        if (this.data.fogChange && this.data.startFogOn === "start") {
            console.log("Starting fog change");

            const scene = this.el.sceneEl;
            scene.setAttribute("fog-control", {
                color: this.data.fogColor,
                duration: this.data.fogDuration,
                density: this.data.fogDensity,
                direction: this.data.fogDirection,
            });
        }

        if (this.isVR) {
            this._moveVR(position);
        } else {
            this._moveDesktop(position, hasRotation ? rotation : null);
        }
    },

    _moveVR(targetPosition) {
        const xrManager = this.el.sceneEl.renderer?.xr;
        if (!xrManager?.isPresenting) {
            this._moveDesktop(targetPosition, null);
            return;
        }

        const camera = this.el.sceneEl.camera;
        if (!camera) return;

        camera.getWorldPosition(this._headOffset);
        this._vrDelta = new THREE.Vector3(
            targetPosition.x - this._headOffset.x,
            targetPosition.y - this._headOffset.y,
            targetPosition.z - this._headOffset.z,
        );
        this._vrApplied = new THREE.Vector3();

        this.animating = true;
        this.useVROffset = true;
        this._animStart = performance.now();
    },

    _moveDesktop(targetPosition, targetRotation) {
        // Find the rig (parent of camera) - move rig instead of camera
        const cameraParent = this.cameraEl?.parentElement;
        const rigEl =
            cameraParent &&
            cameraParent !== this.el.sceneEl &&
            cameraParent.hasAttribute("id")
                ? cameraParent
                : null;

        const target = rigEl?.object3D || this.cameraEl?.object3D;
        if (!target) return;

        this._moveTarget = target;
        this._startPos.copy(target.position);
        this._endPos.set(
            targetPosition.x,
            this.locationSpecified ? targetPosition.y : targetPosition.y - 1.6,
            targetPosition.z,
        );

        this._animateRotation = false;
        if (targetRotation) {
            this._animateRotation = true;
            this._startQuat.copy(target.quaternion);
            this._endQuat.setFromEuler(
                new THREE.Euler(
                    THREE.MathUtils.degToRad(targetRotation.x),
                    THREE.MathUtils.degToRad(targetRotation.y),
                    THREE.MathUtils.degToRad(targetRotation.z),
                    "YXZ",
                ),
            );
        }

        this.animating = true;
        this.useVROffset = false;
        this._animStart = performance.now();
    },

    _applyVROffset(offset) {
        const xrManager = this.el.sceneEl.renderer?.xr;
        if (!xrManager?.isPresenting) return;

        const baseSpace = xrManager.getReferenceSpace();
        if (!baseSpace) return;

        const transform = new XRRigidTransform(
            { x: -offset.x, y: -offset.y, z: -offset.z, w: 1 },
            { x: 0, y: 0, z: 0, w: 1 },
        );
        xrManager.setReferenceSpace(
            baseSpace.getOffsetReferenceSpace(transform),
        );
    },

    tick() {
        if (!this.animating) return;

        const progress = Math.min(
            (performance.now() - this._animStart) / this.data.duration,
            1,
        );
        const eased = easeInOutQuad(progress);

        if (this.useVROffset && this._vrDelta) {
            const target = this._tempVec
                .copy(this._vrDelta)
                .multiplyScalar(eased);
            const increment = new THREE.Vector3().subVectors(
                target,
                this._vrApplied,
            );
            if (increment.lengthSq() > 0.0001) {
                this._applyVROffset(increment);
                this._vrApplied.copy(target);
            }
        } else if (this._moveTarget) {
            this._moveTarget.position.lerpVectors(
                this._startPos,
                this._endPos,
                eased,
            );
            if (this._animateRotation) {
                this._moveTarget.quaternion.slerpQuaternions(
                    this._startQuat,
                    this._endQuat,
                    eased,
                );
            }
        }

        if (progress >= 1) {
            this._finishAnimation();
        }
    },

    _finishAnimation() {
        this.animating = false;

        if (this.useVROffset && this._vrDelta) {
            const remaining = new THREE.Vector3().subVectors(
                this._vrDelta,
                this._vrApplied,
            );
            if (remaining.lengthSq() > 0.0001) this._applyVROffset(remaining);
            this._vrDelta = this._vrApplied = null;
        } else if (this._moveTarget) {
            this._moveTarget.position.copy(this._endPos);
            if (this._animateRotation) {
                this._moveTarget.quaternion.copy(this._endQuat);
                this._animateRotation = false;
            }
        }

        if (this.tunnelEl) {
            this.tunnelEl.removeAttribute("animation__up");
            this.tunnelEl.setAttribute("animation__up", {
                property: "scale.y",
                to: 0.1,
                dur: 500,
                easing: this.data.easing,
            });
        }

        this.cameraEl?.emit("go-to-complete");

        if (this.data.fogChange && this.data.startFogOn === "end") {
            console.log("Starting fog change");

            const scene = this.el.sceneEl;
            scene.setAttribute("fog-control", {
                color: this.data.fogColor,
                duration: this.data.fogDuration,
                density: this.data.fogDensity,
                direction: this.data.fogDirection,
            });
        }
    },

    remove() {
        this.el.removeEventListener("click", this._onClick);
    },
});
