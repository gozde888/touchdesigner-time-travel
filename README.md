# Time Travel

Time Travel is a TouchDesigner component for video transitions, adapted from my work on *Azimuth of Time* for Faisal Anwar at ARTE Museum Dubai. It uses a GLSL fragment shader to blend a cached frame with the current video input, adding horizontal blur, layered flow, and block distortion during the transition.

## Run in TouchDesigner

1. Import `TimeTravel.tox` into an empty project. The source project used TouchDesigner 2025.32820.
2. Add a Movie File In TOP with your own footage and connect it to the component's TOP input. View the component's output.
3. Inside the component, leave `color_mix` at 1 to preview the effect on the live input. Animate `travel_amount` from 0 to 1 and back to 0. Change the `direction` channel in `time_change_direction` between +1 and -1 to reverse the flow.
4. To blend from a held frame, pulse **Active Pulse** on `old_frame` while the outgoing frame is visible. Then animate `color_mix` from 0 to 1 as the new footage plays. The sample uses a black texture in place of the exhibition's silhouette mask.

`time_travel.frag` contains the GLSL source. The component smooths the direction signal and combines it with the effect amount to calculate velocity. A Speed CHOP integrates that velocity into a travel value that advances the shader's motion. Smear and block intensity are separate uniforms.

## Export

Connect the component's output to a Movie File Out TOP. Set the output file and codec, start recording before the transition, and stop recording at the end of the take.
